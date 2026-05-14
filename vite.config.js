import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })
    )
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: ["aocgaiofficeweb.up.railway.app"]
  }
})
