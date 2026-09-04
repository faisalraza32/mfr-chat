/**
 * @mfr/chat/react — the browser half of the chat assistant.
 *
 * The split down the middle of this package is between what is hard to get
 * right and what is merely specific to one app. Hard: the focus trap, the
 * visual-viewport sheet sizing that keeps a phone keyboard from shoving the
 * close button off screen, the idle-session rules, the link allow-list, the
 * streamed-reply announcement. Specific: colours, the router, the icons, the
 * challenge widget, what a tool's action renders as.
 *
 * The first lives here. The second arrives through ChatUIProvider.
 */
export * from "./types.js";
export * from "./class-names.js";
export * from "./context.js";
export * from "./links.js";
export * from "./open-chat.js";
export * from "./parse-stream.js";
export * from "./session.js";
export * from "./storage.js";
export * from "./viewport.js";
export { useChat } from "./use-chat.js";
export type { ChatErrorCopy, UseChatOptions, UseChatResult } from "./use-chat.js";
export { useSheetViewport } from "./use-sheet-viewport.js";
export type { SheetViewport } from "./use-sheet-viewport.js";
export { ChatMessageBubble } from "./ChatMessageBubble.js";
export type { ChatMessageBubbleProps } from "./ChatMessageBubble.js";
export { ChatPanel } from "./ChatPanel.js";
export type { ChatPanelCopy, ChatPanelProps } from "./ChatPanel.js";
export { ChatTeaser } from "./ChatTeaser.js";
export type { ChatTeaserCopy, ChatTeaserProps } from "./ChatTeaser.js";
export { ChatLauncher } from "./ChatLauncher.js";
export type { ChatLauncherProps } from "./ChatLauncher.js";
export { ChatIcon, CloseIcon, SendIcon } from "./icons.js";
