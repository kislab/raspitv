// Verbindet die Seite im Player mit RaspiTV:
//  - Tasten der Fernbedienung (GET /events) werden an die Seite weitergereicht.
//  - Die Seite kann "home" melden, um zu RaspiTV zurückzukehren.
const BASE = "http://127.0.0.1:8765";
let listening = false;

function sendToTabs(key) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { key }).catch(() => {});
  });
}

async function listen() {
  if (listening) return;
  listening = true;
  try {
    const response = await fetch(`${BASE}/events`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (message.startsWith("data: ")) sendToTabs(message.slice(6));
      }
    }
  } catch (error) {
    // RaspiTV nicht erreichbar – beim nächsten Ping der Seite erneut versuchen
  }
  listening = false;
}

chrome.runtime.onMessage.addListener((message) => {
  // Jede Nachricht (auch der regelmäßige "ping" der Seite) hält diesen Worker wach.
  if (message.cmd === "video") {
    fetch(`${BASE}/video`, { method: "POST", body: JSON.stringify({ fps: message.fps }) }).catch(() => {});
  }
  if (message.cmd === "home") {
    fetch(`${BASE}/key`, { method: "POST", body: JSON.stringify({ key: "home" }) }).catch(() => {});
  }
  listen();
});

listen();
