"""Servidor local do SO-boot com ponte segura para o Wi-Fi do Windows.

O processo atende apenas em 127.0.0.1. As senhas recebidas no endpoint de
conexão são usadas uma única vez para criar o perfil do Windows e nunca são
gravadas pelo aplicativo nem retornadas ao navegador.
"""

from __future__ import annotations

import html
import getpass
import json
import locale
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


HOST = "127.0.0.1"
PORT = int(os.environ.get("SO_BOOT_PORT", "8080"))
ROOT = Path(__file__).resolve().parent


def permitted_origin(origin: str | None) -> str | None:
    """Autoriza somente interfaces hospedadas no loopback local."""
    if not origin:
        return None
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        return None
    return origin


def current_account_name() -> str:
    """Retorna o nome da conta Windows da sessão que iniciou o servidor."""
    name = os.environ.get("USERNAME") or getpass.getuser()
    name = name.strip()
    return name[:128] if name else "operador"


def run_terminal_command(command: str) -> tuple[bool, str]:
    """Executa comandos do Windows pela instância local do terminal."""
    command = command.strip()
    if not command:
        return False, "Informe um comando do Windows."
    try:
        process = subprocess.run(
            ["cmd.exe", "/d", "/s", "/c", command],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding=locale.getpreferredencoding(False) or "utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, f"Não foi possível consultar o Windows: {error}"

    output = "\n".join(part for part in (process.stdout, process.stderr) if part).strip()
    if process.returncode != 0:
        return False, output or "O Windows retornou um erro ao executar a consulta."
    if len(output) > 18000:
        output = f"{output[:18000]}\n\n[saída limitada a 18.000 caracteres]"
    return True, output or "(sem saída)"


def run_netsh(*arguments: str) -> tuple[bool, str]:
    """Executa netsh sem expor detalhes sensíveis para o navegador."""
    try:
        process = subprocess.run(
            ["netsh", *arguments], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=25, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    output = "\n".join(part for part in (process.stdout, process.stderr) if part).strip()
    return process.returncode == 0, output


def signal_from_line(line: str) -> int | None:
    match = re.search(r"(\d{1,3})\s*%", line)
    return int(match.group(1)) if match else None


def list_networks() -> list[dict[str, Any]]:
    ok, output = run_netsh("wlan", "show", "networks", "mode=bssid")
    if not ok:
        if "localiza" in output.casefold() or "elevation" in output.casefold() or "eleva" in output.casefold():
            raise RuntimeError(
                "O Windows bloqueou a leitura do Wi-Fi. Ative os Serviços de Localização e inicie o SO-boot como administrador."
            )
        raise RuntimeError("Não foi possível consultar o adaptador Wi-Fi do Windows.")

    networks: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for raw_line in output.splitlines():
        line = raw_line.strip()
        ssid_match = re.match(r"SSID\s+\d+\s*:\s*(.*)", line, re.IGNORECASE)
        if ssid_match:
            ssid = ssid_match.group(1).strip()
            current = {"ssid": ssid, "security": "WPA2", "signal": 0} if ssid else None
            if current is not None:
                networks.append(current)
            continue
        if current is None:
            continue
        normalized = line.casefold()
        if "authentication" in normalized or "autentica" in normalized:
            if "open" in normalized or "aberta" in normalized:
                current["security"] = "Aberta"
            elif "wpa3" in normalized:
                current["security"] = "WPA3"
        if "signal" in normalized or "sinal" in normalized:
            value = signal_from_line(line)
            if value is not None:
                current["signal"] = max(current["signal"], value)

    unique: dict[str, dict[str, Any]] = {}
    for network in networks:
        existing = unique.get(network["ssid"])
        if existing is None or network["signal"] > existing["signal"]:
            unique[network["ssid"]] = network
    return sorted(unique.values(), key=lambda item: (-item["signal"], item["ssid"].casefold()))


def current_network() -> str | None:
    ok, output = run_netsh("wlan", "show", "interfaces")
    if not ok:
        return None
    for raw_line in output.splitlines():
        match = re.match(r"\s*SSID\s*:\s*(.+)", raw_line, re.IGNORECASE)
        if match:
            ssid = match.group(1).strip()
            if ssid:
                return ssid
    return None


def saved_network_profiles() -> set[str]:
    """Retorna os SSIDs que possuem um perfil salvo pelo Windows."""
    ok, output = run_netsh("wlan", "show", "profiles")
    if not ok:
        return set()

    profiles: set[str] = set()
    for raw_line in output.splitlines():
        if ":" not in raw_line:
            continue
        label, profile_name = raw_line.split(":", 1)
        normalized_label = label.casefold()
        if (
            ("profile" not in normalized_label and "perfi" not in normalized_label)
            or "policy" in normalized_label
            or "política" in normalized_label
        ):
            continue
        profile_name = profile_name.strip()
        if profile_name:
            profiles.add(profile_name)
    return profiles


def profile_xml(ssid: str, password: str | None, security_type: str) -> str:
    escaped_ssid = html.escape(ssid, quote=False)
    name_hex = ssid.encode("utf-8").hex().upper()
    if password is None:
        security = "<security><authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption></security>"
    else:
        security = (
            f"<security><authEncryption><authentication>{security_type}</authentication>"
            "<encryption>AES</encryption><useOneX>false</useOneX></authEncryption>"
            f"<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>{html.escape(password, quote=False)}</keyMaterial></sharedKey></security>"
        )
    return (
        '<?xml version="1.0"?>'
        '<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">'
        f"<name>{escaped_ssid}</name><SSIDConfig><SSID><hex>{name_hex}</hex><name>{escaped_ssid}</name></SSID></SSIDConfig>"
        "<connectionType>ESS</connectionType><connectionMode>auto</connectionMode>"
        f"<MSM>{security}</MSM></WLANProfile>"
    )


def connect_network(ssid: str, password: str | None) -> tuple[bool, str]:
    if not ssid or len(ssid) > 128:
        return False, "Nome de rede inválido."
    available = {network["ssid"]: network for network in list_networks()}
    network = available.get(ssid)
    if network is None:
        return False, "A rede não está mais disponível. Atualize a lista e tente novamente."
    if network["security"] == "Aberta":
        password = None
    elif password is None:
        if ssid not in saved_network_profiles():
            return False, "Informe a senha desta rede para criar o perfil no Windows."
        ok, _ = run_netsh("wlan", "connect", f"name={ssid}", f"ssid={ssid}")
        if not ok:
            return False, "O Windows não conseguiu iniciar a conexão com o perfil salvo."
        return True, "Conexão solicitada ao Windows usando a senha salva."
    elif not (8 <= len(password) <= 63):
        return False, "A senha WPA/WPA2 deve ter entre 8 e 63 caracteres."
    security_type = "WPA3SAE" if network["security"] == "WPA3" else "WPA2PSK"

    with tempfile.NamedTemporaryFile(mode="w", suffix=".xml", encoding="utf-8", delete=False) as profile_file:
        profile_file.write(profile_xml(ssid, password, security_type))
        profile_path = Path(profile_file.name)
    try:
        ok, _ = run_netsh("wlan", "add", "profile", f"filename={profile_path}", "user=current")
        if not ok:
            return False, "O Windows não aceitou as credenciais desta rede."
        ok, _ = run_netsh("wlan", "connect", f"name={ssid}", f"ssid={ssid}")
        if not ok:
            return False, "O Windows não conseguiu iniciar a conexão."
        return True, "Conexão solicitada ao Windows."
    finally:
        profile_path.unlink(missing_ok=True)


def disconnect_network() -> tuple[bool, str]:
    ok, _ = run_netsh("wlan", "disconnect")
    return (True, "Desconexão solicitada ao Windows.") if ok else (False, "O Windows não conseguiu desconectar o Wi-Fi.")


def list_disks() -> list[dict[str, Any]]:
    """Lista somente unidades locais que o processo atual consegue acessar."""
    disks: list[dict[str, Any]] = []
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        path = Path(f"{letter}:\\")
        try:
            if not path.is_dir():
                continue
            usage = shutil.disk_usage(path)
        except OSError:
            continue
        disks.append({
            "path": str(path),
            "name": f"Unidade local ({letter}:)",
            "free": usage.free,
            "total": usage.total,
        })
    return disks


def list_devices() -> list[dict[str, Any]]:
    """Lista dispositivos Plug and Play sem expor identificadores de hardware."""
    encoding = locale.getpreferredencoding(False) or "utf-8"
    try:
        process = subprocess.run(
            ["pnputil", "/enum-devices", "/connected"],
            capture_output=True,
            text=True,
            encoding=encoding,
            errors="replace",
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError("Não foi possível consultar os dispositivos do Windows.") from error
    if process.returncode != 0:
        raise RuntimeError("O Windows não disponibilizou a lista de dispositivos nesta sessão.")

    def normalized_label(value: str) -> str:
        decomposed = unicodedata.normalize("NFD", value.casefold())
        return "".join(character for character in decomposed if not unicodedata.combining(character)).strip()

    field_names = {
        "descricao do dispositivo": "name",
        "device description": "name",
        "nome da classe": "category",
        "class name": "category",
        "nome do fabricante": "manufacturer",
        "manufacturer name": "manufacturer",
        "status": "windowsStatus",
        "id da instancia": "instanceId",
        "instance id": "instanceId",
    }
    records: list[dict[str, str]] = []
    current: dict[str, str] = {}
    for raw_line in process.stdout.splitlines():
        line = raw_line.strip()
        if not line:
            if current.get("instanceId"):
                records.append(current)
                current = {}
            continue
        if ":" not in line:
            continue
        label, value = line.split(":", 1)
        field = field_names.get(normalized_label(label))
        if field:
            current[field] = value.strip()
    if current.get("instanceId"):
        records.append(current)

    problems_by_id: dict[str, int] = {}
    try:
        problems_process = subprocess.run(
            ["pnputil", "/enum-devices", "/problem"],
            capture_output=True,
            text=True,
            encoding=encoding,
            errors="replace",
            timeout=30,
            check=False,
        )
        problem_id = ""
        for raw_line in problems_process.stdout.splitlines():
            line = raw_line.strip()
            if ":" not in line:
                continue
            label, value = line.split(":", 1)
            normalized = normalized_label(label)
            if normalized in {"id da instancia", "instance id"}:
                problem_id = value.strip()
            elif normalized in {"codigo do problema", "problem code"} and problem_id:
                code_match = re.search(r"\d+", value)
                problems_by_id[problem_id] = int(code_match.group()) if code_match else 1
    except (OSError, subprocess.TimeoutExpired):
        # A listagem principal continua disponivel quando a verificacao de falhas nao responde.
        pass

    devices: list[dict[str, Any]] = []
    for record in records:
        name = record.get("name") or "Dispositivo sem nome"
        category = record.get("category") or "Outros dispositivos"
        manufacturer = record.get("manufacturer") or "Fabricante não informado"
        error_code = problems_by_id.get(record.get("instanceId", ""), 0)
        devices.append({
            "name": name[:240],
            "category": category[:100],
            "manufacturer": manufacturer[:160],
            "status": "Requer atenção" if error_code else "Operacional",
            "errorCode": error_code,
        })
    return sorted(devices, key=lambda item: (item["status"] != "Requer atenção", item["category"].casefold(), item["name"].casefold()))


def resolve_directory(value: str) -> Path:
    """Normaliza uma pasta Windows e bloqueia caminhos de dispositivo/rede."""
    candidate = value.strip()
    if not candidate or candidate.startswith("\\\\") or candidate.startswith("//"):
        raise ValueError("Informe uma pasta local do Windows.")
    path = Path(candidate).resolve(strict=False)
    if not path.drive or not path.is_dir():
        raise ValueError("A pasta solicitada nao esta disponivel.")
    return path


def list_directory(value: str) -> dict[str, Any]:
    """Retorna metadados de uma pasta local, sem ler o conteudo dos arquivos."""
    path = resolve_directory(value)
    entries: list[dict[str, Any]] = []
    try:
        children = list(path.iterdir())
    except OSError as error:
        raise ValueError("Nao foi possivel abrir esta pasta com as permissoes atuais.") from error

    for child in children[:1000]:
        try:
            stat = child.stat()
            is_directory = child.is_dir()
        except OSError:
            continue
        entries.append({
            "name": child.name,
            "path": str(child),
            "directory": is_directory,
            "size": stat.st_size if not is_directory else None,
            "modifiedAt": stat.st_mtime,
        })
    entries.sort(key=lambda item: (not item["directory"], item["name"].casefold()))
    return {"path": str(path), "entries": entries, "truncated": len(children) > len(entries)}


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def handle(self) -> None:
        """Ignora cancelamentos normais do navegador em conexões locais."""
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def end_headers(self) -> None:
        origin = permitted_origin(self.headers.get("Origin"))
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        if not permitted_origin(self.headers.get("Origin")):
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:
        request = urlparse(self.path)
        if request.path == "/api/session":
            self.send_json({"accountName": current_account_name()})
            return
        if request.path == "/api/disks":
            self.send_json({"disks": list_disks()})
            return
        if request.path == "/api/devices":
            try:
                self.send_json({"devices": list_devices()})
            except RuntimeError as error:
                self.send_json({"error": str(error)}, HTTPStatus.SERVICE_UNAVAILABLE)
            return
        if request.path == "/api/directory":
            directory = parse_qs(request.query).get("path", [""])[0]
            try:
                self.send_json(list_directory(directory))
            except ValueError as error:
                self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
            return
        if request.path != "/api/wifi":
            return super().do_GET()
        try:
            saved_profiles = saved_network_profiles()
            networks = list_networks()
            for network in networks:
                network["saved"] = network["ssid"] in saved_profiles
            self.send_json({"networks": networks, "connectedSsid": current_network()})
        except RuntimeError as error:
            self.send_json({"error": str(error)}, HTTPStatus.SERVICE_UNAVAILABLE)

    def do_POST(self) -> None:
        if self.path not in {"/api/wifi/connect", "/api/wifi/disconnect", "/api/terminal"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if self.path == "/api/terminal":
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if not 0 < content_length <= 8192:
                    raise ValueError
                data = json.loads(self.rfile.read(content_length))
                command = data.get("command", "") if isinstance(data, dict) else ""
                if not isinstance(command, str):
                    raise ValueError
            except (ValueError, json.JSONDecodeError):
                self.send_json({"error": "Comando inválido."}, HTTPStatus.BAD_REQUEST)
                return
            ok, output = run_terminal_command(command)
            self.send_json(
                {"output": output} if ok else {"error": output},
                HTTPStatus.OK if ok else HTTPStatus.BAD_REQUEST,
            )
            return
        if self.path == "/api/wifi/disconnect":
            ok, message = disconnect_network()
            self.send_json({"ok": ok, "message": message}, HTTPStatus.OK if ok else HTTPStatus.BAD_REQUEST)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(content_length))
            ssid = data.get("ssid", "") if isinstance(data, dict) else ""
            password = data.get("password") if isinstance(data, dict) else None
            if not isinstance(ssid, str) or password is not None and not isinstance(password, str):
                raise ValueError
        except (ValueError, json.JSONDecodeError):
            self.send_json({"error": "Solicitação de conexão inválida."}, HTTPStatus.BAD_REQUEST)
            return
        ok, message = connect_network(ssid, password)
        self.send_json({"ok": ok, "message": message}, HTTPStatus.OK if ok else HTTPStatus.BAD_REQUEST)


if __name__ == "__main__":
    print(f"SO-boot disponível em http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), AppHandler).serve_forever()
