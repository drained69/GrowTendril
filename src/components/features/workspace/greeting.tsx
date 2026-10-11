"use client";
import { useEffect, useState } from "react";

const part = (h: number) => (h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");

/** Time-of-day greeting in the viewer's own clock. Server markup is neutral so it never mismatches. */
export function Greeting({ name }: { name: string }) {
  const [text, setText] = useState("Welcome back");
  useEffect(() => setText(part(new Date().getHours())), []);
  return (
    <>
      {text}, {name}
    </>
  );
}

export function Today() {
  const [text, setText] = useState("");
  useEffect(() => setText(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })), []);
  return <span suppressHydrationWarning>{text}</span>;
}
