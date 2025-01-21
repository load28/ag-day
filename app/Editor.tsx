"use client";

import React, { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useMonaco } from "@monaco-editor/react";
import { MonacoLanguageClient } from "monaco-languageclient";
import { CloseAction, ErrorAction } from "vscode-languageclient";
import { IWebSocket, WebSocketMessageReader, WebSocketMessageWriter } from "vscode-ws-jsonrpc";
import * as monaco from "monaco-editor";

// monaco-editor를 SSR 없이 로드
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// WebSocket 래퍼 클래스
class WebSocketWrapper implements IWebSocket {
  private socket: WebSocket;

  constructor(url: string) {
    this.socket = new WebSocket(url);
  }

  send(content: string): void {
    this.socket.send(content);
  }

  onMessage(cb: (data: any) => void): void {
    this.socket.onmessage = (event) => {
      cb(event.data);
    };
  }

  onError(cb: (reason: any) => void): void {
    this.socket.onerror = (event) => {
      cb(event);
    };
  }

  onClose(cb: (code: number, reason: string) => void): void {
    this.socket.onclose = (event) => {
      cb(event.code, event.reason);
    };
  }

  dispose(): void {
    this.socket.close();
  }
}

const Editor: React.FC = () => {
  const monaco = useMonaco();
  const languageClientRef = useRef<MonacoLanguageClient | null>(null);
  const socketRef = useRef<WebSocketWrapper | null>(null);
  const readerRef = useRef<WebSocketMessageReader | null>(null);
  const writerRef = useRef<WebSocketMessageWriter | null>(null);

  useEffect(() => {
    if (!monaco) return;

    // Monaco 워커 설정
    (self as any).MonacoEnvironment = {
      getWorkerUrl: function (_moduleId: any, label: string) {
        if (label === "typescript" || label === "javascript") {
          return "_next/static/ts.worker.js";
        }
        return "_next/static/editor.worker.js";
      },
    };

    const initLanguageClient = async () => {
      try {
        // LSP 서버 연결
        const url = "ws://localhost:3000/languages";
        socketRef.current = new WebSocketWrapper(url);
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

        // LSP 클라이언트 시작
        await languageClientRef.current.start();
        console.log("Language client started successfully");
      } catch (error) {
        console.error("Failed to initialize language client:", error);
      }
    };

    initLanguageClient();

    // 컴포넌트 언마운트 시 정리
    return () => {
      languageClientRef.current?.stop();
      readerRef.current?.dispose();
      writerRef.current?.dispose();
      socketRef.current?.dispose();
    };
  }, [monaco]);

  const handleEditorMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    // 에디터 마운트 시 추가 설정
    editor.updateOptions({
      automaticLayout: true,
      minimap: { enabled: false },
    });
  };

  return (
    <MonacoEditor
      height="90vh"
      defaultLanguage="typescript"
      defaultValue=""
      onMount={handleEditorMount}
      options={{
        scrollBeyondLastLine: false,
        fontSize: 14,
        lineNumbers: "on",
        renderWhitespace: "none",
        formatOnPaste: true,
        formatOnType: true,
      }}
    />
  );
};

export default Editor;
