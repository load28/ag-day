"use client";

import React, { useEffect, useRef } from "react";
import { MonacoLanguageClient } from "monaco-languageclient";
import { IWebSocket, WebSocketMessageReader, WebSocketMessageWriter } from "vscode-ws-jsonrpc";
import * as monaco from "monaco-editor";
import { CloseAction, ErrorAction } from "vscode-languageclient";
import { loader } from "@monaco-editor/react";

// Monaco Editor 로더 설정
loader.config({
  paths: {
    vs: "/_next/static/monaco-editor/min/vs",
  },
});

// monaco-editor를 SSR 없이 로드
// const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

class WebSocketWrapper implements IWebSocket {
  private socket: WebSocket;
  private isConnected: boolean = false;

  constructor(url: string) {
    this.socket = new WebSocket(url);

    this.socket.addEventListener("open", () => {
      console.log("WebSocket connected");
      this.isConnected = true;
    });
  }

  isReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected) {
        resolve();
        return;
      }

      const onOpen = () => {
        this.isConnected = true;
        this.socket.removeEventListener("open", onOpen);
        this.socket.removeEventListener("error", onError);
        resolve();
      };

      const onError = (error: Event) => {
        this.socket.removeEventListener("open", onOpen);
        this.socket.removeEventListener("error", onError);
        reject(error);
      };

      this.socket.addEventListener("open", onOpen);
      this.socket.addEventListener("error", onError);
    });
  }

  send(content: string): void {
    this.socket.send(content);
  }

  onMessage(cb: (data: any) => void): void {
    this.socket.addEventListener("message", (event) => {
      cb(event.data);
    });
  }

  onError(cb: (reason: any) => void): void {
    this.socket.addEventListener("error", (event) => {
      cb(event);
    });
  }

  onClose(cb: (code: number, reason: string) => void): void {
    this.socket.addEventListener("close", (event) => {
      cb(event.code, event.reason);
    });
  }

  dispose(): void {
    this.socket.close();
  }
}

const Editor: React.FC = () => {
  // const monaco = useMonaco();
  const languageClientRef = useRef<MonacoLanguageClient | null>(null);
  const socketRef = useRef<WebSocketWrapper | null>(null);
  const readerRef = useRef<WebSocketMessageReader | null>(null);
  const writerRef = useRef<WebSocketMessageWriter | null>(null);
  const divEl = useRef<HTMLDivElement>(null);
  let editor: monaco.editor.IStandaloneCodeEditor;

  useEffect(() => {
    if (!divEl.current) return;

    // Monaco Editor 환경 설정
    self.MonacoEnvironment = {
      getWorkerUrl: function (_moduleId: string, label: string) {
        const workerPath = "/_next/static";

        if (label === "json") {
          return `${workerPath}/json.worker.js`;
        }
        if (label === "css" || label === "scss" || label === "less") {
          return `${workerPath}/css.worker.js`;
        }
        if (label === "html" || label === "handlebars" || label === "razor") {
          return `${workerPath}/html.worker.js`;
        }
        if (label === "typescript" || label === "javascript") {
          return `${workerPath}/ts.worker.js`;
        }

        if (label === "rust") {
          return `${workerPath}/rust.worker.js`;
        }
        return `${workerPath}/editor.worker.js`;
      },
    };

    try {
      // LSP 클라이언트 시작
      console.log("Language client started successfully");
      editor = monaco.editor.create(divEl.current, {
        value: "",
        language: "rust",
        theme: "vs-dark",
        automaticLayout: true,
      });

      handleEditorMount(editor);
    } catch (error) {
      console.error("Failed to initialize language client:", error);
    }

    // 컴포넌트 언마운트 시 정리
    return () => {
      languageClientRef.current?.stop();
      editor?.dispose();
      readerRef.current?.dispose();
      writerRef.current?.dispose();
      socketRef.current?.dispose();
    };
  }, []);

  const handleEditorMount = async (editor: monaco.editor.IStandaloneCodeEditor) => {
    // LSP 서버 연결
    const url = "ws://localhost:4000/languages";
    socketRef.current = new WebSocketWrapper(url);
    // 웹소켓 연결이 완료될 때까지 대기
    await socketRef.current.isReady();

    readerRef.current = new WebSocketMessageReader(socketRef.current);
    writerRef.current = new WebSocketMessageWriter(socketRef.current);

    // Language Client 초기화
    languageClientRef.current = new MonacoLanguageClient({
      name: "Language Client",
      clientOptions: {
        documentSelector: ["rust", "typescript", "javascript"],
        errorHandler: {
          error: () => ({ action: ErrorAction.Continue }),
          closed: () => ({ action: CloseAction.DoNotRestart }),
        },
      },
      // 통신 설정
      messageTransports: {
        reader: readerRef.current,
        writer: writerRef.current,
      },
    });

    await languageClientRef.current.start();

    // 에디터 마운트 시 추가 설정
    editor.updateOptions({
      automaticLayout: true,
      minimap: { enabled: false },
    });
  };

  return <div className="h-screen w-full" ref={divEl} />;
};

export default Editor;
