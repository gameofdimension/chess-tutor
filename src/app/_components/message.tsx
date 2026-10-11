import ReactMarkdown from "react-markdown";
import rehypeExternalLinks from "rehype-external-links";

export interface MessageBubbleProps {
  content: string;
}

export default function MessageBubble({ content }: MessageBubbleProps) {
  return (
    <div className="coach-message rounded-xl border border-[#E2DAC6] bg-white p-4">
      <ReactMarkdown rehypePlugins={[[rehypeExternalLinks, { target: "_blank", rel: ["nofollow", "noopener", "noreferrer"] }]]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
