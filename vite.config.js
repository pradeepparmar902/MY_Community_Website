import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function gdriveProxyPlugin() {
  const handleProxy = (req, res) => {
    if (!req.url || !req.url.startsWith('/__gdrive_proxy__')) return false
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end(JSON.stringify({ success: false, error: 'Method not allowed' }))
      return true
    }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', async () => {
      try {
        const { scriptUrl, payload } = JSON.parse(body || '{}')
        if (!scriptUrl) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ success: false, error: 'Missing scriptUrl' }))
          return
        }
        const upstream = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload || {}),
          redirect: 'follow'
        })
        const text = await upstream.text()
        res.setHeader('Content-Type', 'application/json')
        try {
          const parsed = JSON.parse(text)
          res.statusCode = 200
          res.end(JSON.stringify(parsed))
        } catch (parseErr) {
          let friendlyError = 'Google Script returned an HTML page instead of JSON.'
          if (upstream.url?.includes('accounts.google.com') || text.includes('accounts.google.com') || text.includes('ServiceLogin') || text.includes('ppConfig')) {
            friendlyError = "Almost there! In your 'Who has access' dropdown, you selected 'Anyone with a Google Account'. Please change it to 'Anyone' (the last option at the bottom of the dropdown), click Deploy, and copy the new Web App URL into the box above!"
          } else if (text.includes('Authorization is required') || text.includes('permission') || text.includes('DriveApp')) {
            friendlyError = "Drive Permission Needed: In script.google.com editor, click '▶ Run' at the top toolbar once and click 'Review Permissions → Advanced → Allow', then click Deploy → Manage deployments → Edit (✏️) → Version: 'New version' → Deploy."
          } else if (text.includes('doPost') || text.includes('Script function not found')) {
            friendlyError = "Old Deployment Active: Make sure you saved the script (Ctrl+S) in script.google.com, then click Deploy → Manage deployments → Edit (✏️) → Version: 'New version' → Deploy."
          } else {
            const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220)
            if (snippet) friendlyError += ` Details: ${snippet}`
          }
          res.statusCode = 200
          res.end(JSON.stringify({ success: false, error: friendlyError }))
        }
      } catch (err) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: false, error: 'Proxy error: ' + err.message }))
      }
    })
    return true
  }

  return {
    name: 'gdrive-proxy-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!handleProxy(req, res)) next()
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), gdriveProxyPlugin()],
  base: './',
})

