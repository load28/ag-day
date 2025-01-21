"use client";

import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

// Monaco Editor 로더 설정
loader.config({
  paths: {
    vs: "/_next/static/monaco-editor/min/vs",
  },
});

export default function Editor() {
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

    // 에디터 인스턴스 생성
    editor = monaco.editor.create(divEl.current, {
      value: ["function x() {", '\tconsole.log("Hello world!");', "}"].join("\n"),
      language: "html",
      theme: "vs-dark",
      automaticLayout: true,
    });

    return () => {
      editor?.dispose();
    };
  }, []);

  return <div className="h-screen w-full" ref={divEl} />;
}
