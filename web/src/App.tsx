import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

function App() {
  const didConnect = useRef(false);
  const isMobile = useIsMobile();
  const activeConvId = useStore((s) => s.activeConversationId);
  const [showSidebar, setShowSidebar] = useState(true);

  useEffect(() => {
    if (!didConnect.current) {
      didConnect.current = true;
      useStore.getState().connect();
    }
  }, []);

  useEffect(() => {
    if (!isMobile || !activeConvId) return;
    const frame = requestAnimationFrame(() => setShowSidebar(false));
    return () => cancelAnimationFrame(frame);
  }, [activeConvId, isMobile]);

  if (isMobile) {
    return (
      <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
        {showSidebar ? (
          <div style={{ width: "100%", height: "100%" }}>
            <Sidebar />
          </div>
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
            <button
              onClick={() => setShowSidebar(true)}
              className="shrink-0 h-10 px-4 border-b-2 border-brutal-ink bg-white flex items-center gap-2 text-sm font-bold"
            >
              ← Back
            </button>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <ChatArea />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh" }}>
      <Sidebar />
      <ChatArea />
    </div>
  );
}

export default App;
