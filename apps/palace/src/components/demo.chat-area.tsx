import { useState } from "react";

import { useChat, useMessages } from "@/hooks/demo.useChat";

import Messages from "./demo.messages";

export default function ChatArea() {
  const { sendMessage } = useChat();

  const messages = useMessages();

  const [message, setMessage] = useState("");
  const [user, setUser] = useState("Alice");

  const postMessage = () => {
    if (message.trim().length) {
      sendMessage(message, user);
      setMessage("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      postMessage();
    }
  };

  return (
    <>
      <div className="space-y-4 px-4 py-6">
        <Messages messages={messages} user={user} />
      </div>

      <div className="border-t border-gray-200 bg-white px-4 py-4">
        <div className="flex items-center space-x-3">
          <select
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="Alice">Alice</option>
            <option value="Bob">Bob</option>
          </select>

          <div className="relative flex-1">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message..."
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <button
            onClick={postMessage}
            disabled={message.trim() === ""}
            className="rounded-lg bg-blue-500 px-6 py-2 text-white transition-colors hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
}
