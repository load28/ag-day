import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import { createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind } from "vscode-languageserver/node.js";
import { Disposable } from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";

// WebSocket을 통한 메시지 읽기/쓰기를 위한 클래스
class WebSocketMessageReader {
  constructor(socket) {
    this.socket = socket;
    this.callback = undefined;
    this.errorHandler = undefined;
    this.closeHandler = undefined;

    this.socket.on("message", (data) => {
      if (this.callback) {
        this.callback(data.toString());
      }
    });

    this.socket.on("error", (error) => {
      if (this.errorHandler) {
        this.errorHandler(error);
      }
    });

    this.socket.on("close", () => {
      if (this.closeHandler) {
        this.closeHandler();
      }
    });
  }

  listen(callback) {
    this.callback = callback;
    return Disposable.create(() => {
      this.callback = undefined;
    });
  }

  onError(handler) {
    this.errorHandler = handler;
    return Disposable.create(() => {
      this.errorHandler = undefined;
    });
  }

  onClose(handler) {
    this.closeHandler = handler;
    return Disposable.create(() => {
      this.closeHandler = undefined;
    });
  }

  dispose() {
    this.socket.close();
  }
}

class WebSocketMessageWriter {
  constructor(socket) {
    this.socket = socket;
    this.errorHandler = undefined;
    this.closeHandler = undefined;

    this.socket.on("error", (error) => {
      if (this.errorHandler) {
        this.errorHandler([error]);
      }
    });

    this.socket.on("close", () => {
      if (this.closeHandler) {
        this.closeHandler();
      }
    });
  }

  write(msg) {
    return new Promise((resolve, reject) => {
      this.socket.send(msg, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  onError(handler) {
    this.errorHandler = handler;
    return Disposable.create(() => {
      this.errorHandler = undefined;
    });
  }

  onClose(handler) {
    this.closeHandler = handler;
    return Disposable.create(() => {
      this.closeHandler = undefined;
    });
  }

  dispose() {
    this.socket.close();
  }
}

class RustAnalyzerProxy {
  constructor() {
    this.analyzer = null;
    this.messageQueue = [];
    this.nextRequestId = 1;
    this.pendingRequests = new Map();
  }

  start() {
    try {
      this.analyzer = spawn("rust-analyzer");

      this.analyzer.stdout.on("data", (data) => {
        try {
          const messages = data.toString().split("\n").filter(Boolean);
          messages.forEach((message) => {
            const parsed = JSON.parse(message);
            if (parsed.id) {
              const handler = this.pendingRequests.get(parsed.id);
              if (handler) {
                handler(null, parsed.result);
                this.pendingRequests.delete(parsed.id);
              }
            }
          });
        } catch (error) {
          console.error("Error parsing rust-analyzer output:", error);
        }
      });

      this.analyzer.stderr.on("data", (data) => {
        console.error("rust-analyzer error:", data.toString());
      });

      this.analyzer.on("error", (error) => {
        console.error("Error starting rust-analyzer:", error);
        throw error;
      });
    } catch (error) {
      console.error("Failed to start rust-analyzer:", error);
      throw error;
    }
  }

  async sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.analyzer) {
        reject(new Error("rust-analyzer is not running"));
        return;
      }

      const id = this.nextRequestId++;
      const request = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });

      try {
        this.analyzer.stdin.write(JSON.stringify(request) + "\n");
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  shutdown() {
    if (this.analyzer) {
      try {
        this.analyzer.kill();
      } catch (error) {
        console.error("Error shutting down rust-analyzer:", error);
      } finally {
        this.analyzer = null;
        this.pendingRequests.clear();
      }
    }
  }
}

// WebSocket 서버 설정
const PORT = 4000;
const wss = new WebSocketServer({
  port: PORT,
  path: "/languages",
  verifyClient: (info, cb) => {
    // 필요한 경우 여기서 클라이언트 검증 로직 추가
    cb(true);
  },
});

// 서버 에러 핸들링
wss.on("error", (error) => {
  console.error("WebSocket Server Error:", error);
});

wss.on("connection", (ws, req) => {
  console.log(`Client connected from ${req.connection.remoteAddress}`);

  const rustAnalyzer = new RustAnalyzerProxy();

  // rust-analyzer 시작 시 에러 처리 추가
  try {
    rustAnalyzer.start();
  } catch (error) {
    console.error("Failed to start rust-analyzer:", error);
    ws.close(1011, "Failed to start language server");
    return;
  }

  // 웹소켓 connection 상태 체크를 위한 ping-pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping(() => {});
    }
  }, 30000);

  // WebSocket 기반 메시지 핸들러 생성
  const reader = new WebSocketMessageReader(ws);
  const writer = new WebSocketMessageWriter(ws);

  // LSP 연결 생성
  const connection = createConnection(ProposedFeatures.all, reader, writer);
  const documents = new TextDocuments(TextDocument);

  // 초기화 핸들러
  connection.onInitialize((params) => {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: [".", ":", "<", '"', "'", "/"],
        },
        signatureHelpProvider: {
          triggerCharacters: ["(", ","],
        },
        hoverProvider: true,
        definitionProvider: true,
        typeDefinitionProvider: true,
        implementationProvider: true,
        referencesProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        codeActionProvider: {
          codeActionKinds: ["quickfix", "refactor", "refactor.extract", "refactor.inline"],
        },
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        renameProvider: true,
        foldingRangeProvider: true,
        semanticTokensProvider: {
          full: true,
          range: false,
        },
      },
    };
  });

  // 초기화 완료 핸들러
  connection.onInitialized(() => {
    console.log("LSP connection initialized");
  });

  // 문서 변경사항 처리
  documents.listen(connection);

  // 코드 완성
  connection.onCompletion(async (params) => {
    try {
      return await rustAnalyzer.sendRequest("textDocument/completion", params);
    } catch (error) {
      console.error("Completion error:", error);
      return [];
    }
  });

  // 호버
  connection.onHover(async (params) => {
    try {
      return await rustAnalyzer.sendRequest("textDocument/hover", params);
    } catch (error) {
      console.error("Hover error:", error);
      return null;
    }
  });

  // 정의로 이동
  connection.onDefinition(async (params) => {
    try {
      return await rustAnalyzer.sendRequest("textDocument/definition", params);
    } catch (error) {
      console.error("Definition error:", error);
      return null;
    }
  });

  // 문서 심볼
  connection.onDocumentSymbol(async (params) => {
    try {
      return await rustAnalyzer.sendRequest("textDocument/documentSymbol", params);
    } catch (error) {
      console.error("Document symbol error:", error);
      return [];
    }
  });

  // 작업공간 심볼
  connection.onWorkspaceSymbol(async (params) => {
    try {
      return await rustAnalyzer.sendRequest("workspace/symbol", params);
    } catch (error) {
      console.error("Workspace symbol error:", error);
      return [];
    }
  });

  // 참조 찾기
  connection.onReferences(async (params) => {
    try {
      return await rustAnalyzer.sendRequest("textDocument/references", params);
    } catch (error) {
      console.error("References error:", error);
      return [];
    }
  });

  // LSP 연결 시작
  connection.listen();

  // 연결 종료 처리
  ws.on("close", (code, reason) => {
    console.log(`Client disconnected. Code: ${code}, Reason: ${reason}`);
    clearInterval(pingInterval);
    rustAnalyzer.shutdown();
    connection.dispose();
  });

  // 에러 처리
  ws.on("error", (error) => {
    console.error("WebSocket connection error:", error);
    clearInterval(pingInterval);
    rustAnalyzer.shutdown();
    connection.dispose();
  });
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

console.log(`Rust LSP WebSocket server running on ws://localhost:${PORT}/languages`);
