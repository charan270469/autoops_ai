import { useEffect, useRef, useState } from "react";
import { WS_URL } from "../config/endpoints.js";

/**
 * @param {(data: { type?: string, workflow?: object }) => void} onMessage
 */
export function useWebSocket(onMessage) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        onMessageRef.current?.(data);
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  return { connected, wsRef };
}
