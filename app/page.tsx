"use client";

import dynamic from "next/dynamic";

const DynamicEditor = dynamic(() => import("./Editor"), {
  loading: () => <p>Loading...</p>,
  ssr: false,
});

export default function Home() {
  return (
    <div>
      <DynamicEditor />
    </div>
  );
}
