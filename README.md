# SO-boot

Ambiente de sistema operacional simulado no navegador. Inclui inicialização, desktop, notas persistentes, monitor de recursos e gerenciador de arquivos local integrado ao terminal.

<img width="800" height="600" alt="image" src="https://github.com/user-attachments/assets/4471a761-9598-4ac2-a0e5-55f3a622f03e" />

<img width="800" height="600" alt="image" src="https://github.com/user-attachments/assets/bc4db59e-2381-446d-ae08-42cfa9d58475" />

<img width="800" height="600" alt="image" src="https://github.com/user-attachments/assets/73643250-b351-4488-9ba6-498b61c2698f" />

<img width="1919" height="1077" alt="image" src="https://github.com/user-attachments/assets/b2e0b6b1-a365-4b1f-a80d-671fdf7347b5" />





## Executar

```powershell
./start-so-boot-admin.cmd
```

O iniciador abre a página automaticamente. Ele usa a porta `8080` quando
disponível e escolhe a próxima porta livre caso outro servidor já a esteja
usando.

## Wi-Fi real

O servidor local consulta redes visíveis e solicita conexão ou desconexão pelo
`netsh` do Windows. Confirme o UAC aberto pelo iniciador e mantenha os Serviços
de Localização do Windows ativos. Ele escuta somente em `127.0.0.1`; a senha é
enviada apenas ao Windows para criar o perfil de rede e não é armazenada pelo
SO-boot. Ao listar as redes, o sistema identifica perfis já salvos pelo Windows
e conecta essas redes sem voltar a pedir a senha.

## Gerenciador de dispositivos

Abra **Dispositivos** no desktop ou na barra inferior para consultar o hardware Plug and Play conectado ao Windows. A tela mostra nome, categoria, fabricante e dispositivos que requerem atenção; ela é somente de leitura e não expõe IDs de hardware ao navegador.

## Comandos do terminal

Locais: `help`, `status`, `date`, `clear`, `ls`, `cat <arquivo>` e `touch <arquivo>`.

Comandos reais do Windows são executados pelo `cmd.exe` local. Exemplos:
`whoami`, `hostname`, `ipconfig`, `netstat`, `tasklist`, `dir` e `systeminfo`.
Os comandos são executados com a mesma conta que iniciou o SO-boot e têm o
mesmo alcance dessa conta.

## Arquivos locais

Abra **Arquivos** para criar e editar textos. O conteúdo é armazenado apenas no `localStorage` do navegador. Use `ls` no Terminal para listar os itens e `cat Nome.txt` para ver um arquivo.
