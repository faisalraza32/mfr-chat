"use client";

import { Fragment } from "react";

import { cx } from "./class-names.js";
import { useChatUI } from "./context.js";
import { splitLinkedText } from "./links.js";

export interface ChatMessageBubbleProps {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
  /** Accessible label for the thinking indicator. */
  thinkingLabel?: string;
}

export function ChatMessageBubble({
  role,
  text,
  pending,
  thinkingLabel = "Thinking",
}: ChatMessageBubbleProps) {
  const { classNames, Link, linkPattern } = useChatUI();
  const isUser = role === "user";

  const rendered = splitLinkedText(text, linkPattern).map((segment, index) => {
    if (segment.kind === "text") {
      return <Fragment key={index}>{segment.text}</Fragment>;
    }

    if (segment.kind === "internal") {
      return (
        <Link key={index} to={segment.text} className={classNames.bubbleLink}>
          {segment.text}
        </Link>
      );
    }

    return (
      <a
        key={index}
        href={segment.text}
        target="_blank"
        rel="noopener noreferrer"
        className={classNames.bubbleLink}
      >
        {segment.text}
      </a>
    );
  });

  return (
    <div
      className={cx(classNames.bubbleRow, isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cx(
          classNames.bubble,
          isUser ? classNames.bubbleUser : classNames.bubbleAssistant
        )}
      >
        {text ? rendered : null}
        {pending && !text ? (
          <span className="inline-flex gap-1" aria-label={thinkingLabel}>
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className={classNames.typingDot}
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}
