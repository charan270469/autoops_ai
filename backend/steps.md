# Backend server — stop and start

The HTTP server and WebSocket server share the same Node process. Stopping the process stops both.

## Windows (PowerShell)

Create **ssh rsa** keys
ssh -R 80:localhost:3001 -i /d/Programming/Hackathons/autoops-ai/.ssh/id_rsa localhost.run

**Stop** whatever is listening on port **3001** (server + WebSockets):

```powershell
Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
```

**Start** the backend from the `backend` folder (loads `.env` via `env-bootstrap.js`):

```powershell
cd d:\Programming\Hackathons\autoops-ai\backend
node server.js
```

Or:

```powershell
cd d:\Programming\Hackathons\autoops-ai\backend
npm start
```

**PORT Forward**
```bash
ssh -R 80:localhost:3001 -i /d/Programming/Hackathons/autoops-ai/.ssh/id_rsa localhost.run
```

---

## Windows (Command Prompt)

Find PID on port 3001, then kill (replace `<PID>`):

```cmd
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

Start:

```cmd
cd /d d:\Programming\Hackathons\autoops-ai\backend
node server.js
```

---

## Verify

```powershell
Invoke-RestMethod http://localhost:3001/healthz
```

Expected: `ok` is `true`.
