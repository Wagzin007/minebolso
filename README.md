# ⬛ MineBolso

> Seu servidor Minecraft Java local, acessível de qualquer lugar.  
> Sem VPN. Sem Hamachi. Sem mensalidade. 100% open source.

---

## O que é

**MineBolso** é um gerenciador de servidores Minecraft Java que roda localmente no seu **celular Android** (via Termux) ou no seu **PC Linux/Windows/Mac**.

Você coloca a pasta do seu servidor (com `server.jar`, mods, plugins) em um lugar específico, abre o MineBolso no navegador e gerencia tudo por ali: iniciar/parar, ver o log em tempo real, executar comandos, ver jogadores, editar arquivos — tudo com um tunnel automático via **playit.gg** que gera um link público para seus amigos conectarem.

---

## Requisitos

| Plataforma | Requisito |
|---|---|
| Android 10+ | Termux (F-Droid), Java 21, Node.js 18+ |
| Linux (PC) | Java 21+, Node.js 18+ |
| Windows | Java 21+, Node.js 18+, Git Bash ou WSL |
| macOS | Java 21+, Node.js 18+ |

---

## Instalação rápida

### 📱 Android (Termux) — Recomendado

```bash
# 1. Instale o Termux pela F-Droid (não pela Play Store)
#    https://f-droid.org/packages/com.termux/

# 2. Abra o Termux e execute:
pkg update && pkg upgrade -y
pkg install nodejs openjdk-21 git unzip -y

# 3. Clone o MineBolso
git clone https://github.com/seu-usuario/minebolso
cd minebolso

# 4. Instale as dependências
npm install

# 5. Inicie
npm start
```

### 🐧 Linux (PC)

```bash
# Certifique-se de ter Node.js 18+ e Java 21+
node --version   # deve ser >= 18
java --version   # deve ser >= 21

git clone https://github.com/seu-usuario/minebolso
cd minebolso
npm install
npm start
```

### 🪟 Windows

```bat
REM Instale Node.js em https://nodejs.org e Java 21 em https://adoptium.net

git clone https://github.com/seu-usuario/minebolso
cd minebolso
npm install
npm start
```

---

## Como adicionar seu servidor

O MineBolso detecta automaticamente qualquer pasta dentro de:

```
~/minebolso/.minecraft/versions/
```

### Estrutura esperada

```
~/minebolso/.minecraft/
└── versions/
    └── NomeDaSuaPasta/          ← você cria esta pasta
        ├── server.jar            ← OBRIGATÓRIO
        ├── server.properties     ← criado automaticamente se não existir
        ├── eula.txt              ← aceito automaticamente
        ├── world/                ← criado pelo Minecraft na 1ª vez
        ├── plugins/              ← Paper, Spigot, Purpur
        └── mods/                 ← Forge, Fabric, NeoForge
```

### Exemplos de nomes de pasta

| Pasta | O que é |
|---|---|
| `1.20.4` | Servidor vanilla 1.20.4 |
| `1.20.4-paper` | Paper 1.20.4 |
| `1.19.2-forge` | Forge 1.19.2 com mods |
| `survival-amigos` | Qualquer nome funciona |

### Onde fica no Android (Termux)?

```
/data/data/com.termux/files/home/minebolso/.minecraft/versions/
```

Crie a pasta assim:
```bash
mkdir -p ~/minebolso/.minecraft/versions/1.20.4
# Coloque seu server.jar lá:
cp /sdcard/Download/server.jar ~/minebolso/.minecraft/versions/1.20.4/
```

---

## Acessando o painel

Após `npm start`, abra no navegador:

```
http://localhost:25580
```

No Android, o Termux e o navegador rodam no mesmo dispositivo, então funciona direto.

Se quiser acessar de outro dispositivo na mesma rede Wi-Fi:

```
http://IP_DO_CELULAR:25580
```

> Para saber o IP: `ip addr show wlan0` no Termux.

---

## Usando o tunnel playit.gg

O tunnel é iniciado automaticamente quando você inicia o MineBolso (se `autoTunnel: true` nas configurações).

Na aba **Tunnel** você verá um endereço como:

```
bold-frog-42.joinmc.link:25565
```

Seus amigos usam exatamente este endereço no Minecraft → Multiplayer → Adicionar servidor. **Sem precisar configurar nada no roteador, sem VPN, sem Hamachi.**

> O binário do playit-agent é baixado automaticamente na primeira vez.  
> Se quiser baixar manualmente: https://playit.gg/downloads

---

## Configurações avançadas

O arquivo de configuração fica em `data/minebolso.config.json`:

```json
{
  "port": 25580,
  "javaPath": "java",
  "baseDir": "~/minebolso/.minecraft",
  "versionsDir": "~/minebolso/.minecraft/versions",
  "autoTunnel": true,
  "playitBin": "~/.minebolso/playit",
  "watchdog": {
    "enabled": true,
    "autoRestart": true,
    "tpsThreshold": 15,
    "tpsAlertCycles": 3,
    "ramThreshold": 90,
    "checkIntervalMs": 10000
  }
}
```

| Campo | Descrição |
|---|---|
| `port` | Porta do painel web |
| `javaPath` | Caminho do Java (`java` se estiver no PATH) |
| `autoTunnel` | Iniciar tunnel automaticamente |
| `watchdog.autoRestart` | Reiniciar servidor se crashar |
| `watchdog.tpsThreshold` | TPS mínimo antes de alertar |

---

## Watchdog

O Watchdog monitora seus servidores a cada 10 segundos e:

- **Detecta crash** e reinicia automaticamente (se configurado)
- **Alerta TPS baixo** quando o servidor está lento
- **Alerta RAM alta** quando o Java está usando mais de 90% do alocado
- **Exibe alertas** em tempo real no painel → aba Watchdog

---

## Dicas para Android

### Manter o Termux rodando em background

```bash
# Instale termux-services para manter o MineBolso rodando
pkg install termux-services
```

Ou simplesmente mantenha o Termux aberto (use o bloqueio de tela sem fechar).

### RAM recomendada por tipo de servidor

| Tipo | RAM mínima |
|---|---|
| Vanilla / Paper sem plugins | 1 GB |
| Paper com 10-20 plugins | 2 GB |
| Forge/Fabric com mods | 3-4 GB |
| Modpack pesado | 4-6 GB |

> Em Android, lembre-se que o sistema também usa RAM. Deixe pelo menos 1 GB livre para o sistema.

### Onde baixar server.jar

| Tipo | Link |
|---|---|
| Paper (recomendado) | https://papermc.io/downloads |
| Vanilla | https://www.minecraft.net/pt-br/download/server |
| Fabric | https://fabricmc.net/use/server/ |
| Forge | https://files.minecraftforge.net |
| Purpur | https://purpurmc.org |

---

## API REST

O MineBolso expõe uma API REST local em `http://localhost:25580/api`.

```
GET  /api/servers                    → lista servidores
POST /api/servers/:id/start          → iniciar
POST /api/servers/:id/stop           → parar
POST /api/servers/:id/restart        → reiniciar
POST /api/servers/:id/command        → enviar comando { "cmd": "..." }
PATCH /api/servers/:id               → atualizar config { "ram": 2, "name": "..." }

GET  /api/files?serverId=X&path=.    → listar arquivos
PUT  /api/files                      → salvar arquivo { "filePath": "...", "content": "..." }

GET  /api/players/:id                → jogadores online
POST /api/players/:id/kick           → kick { "player": "..." }
POST /api/players/:id/ban            → ban { "player": "..." }
POST /api/players/:id/op             → op { "player": "..." }

GET  /api/system                     → CPU/RAM/disco do host
GET  /api/tunnel                     → status do tunnel
POST /api/tunnel/start               → iniciar tunnel
POST /api/tunnel/stop                → parar tunnel
POST /api/tunnel/restart             → reiniciar tunnel (novo link)

GET  /api/config                     → ler config global
PATCH /api/config                    → atualizar config global
```

### WebSocket Terminal

```
ws://localhost:25580/terminal
```

```json
// Inscrever em logs de um servidor:
{ "type": "subscribe", "serverId": "1.20.4" }

// Enviar comando:
{ "type": "command", "serverId": "1.20.4", "cmd": "say Olá!" }

// Resposta de log:
{ "type": "log", "serverId": "1.20.4", "line": "...", "level": "INFO" }
```

---

## Estrutura do projeto

```
minebolso/
├── src/
│   ├── index.js                ← Entry point
│   ├── config.js               ← Config global + detecção Android
│   ├── server/
│   │   ├── ServerScanner.js    ← Detecta versões no filesystem
│   │   ├── ServerProcess.js    ← Spawn/controle do processo Java
│   │   └── ServerManager.js   ← Lifecycle + singleton
│   ├── watchdog/
│   │   └── Watchdog.js         ← Monitor TPS/RAM/crash
│   ├── tunnel/
│   │   └── PlayitManager.js    ← playit-agent subprocess + download
│   ├── ws/
│   │   └── TerminalSocket.js   ← WebSocket bridge
│   ├── api/
│   │   └── routes.js           ← Todos os endpoints REST
│   └── public/
│       └── index.html          ← UI completa (single file)
├── data/
│   ├── minebolso.config.json   ← Config global
│   └── servers.json            ← Metadados dos servidores
├── package.json
└── README.md
```

---

## Licença

MIT — livre para usar, modificar e distribuir.

---

*MineBolso — Feito para a comunidade. Open source e gratuito.*
