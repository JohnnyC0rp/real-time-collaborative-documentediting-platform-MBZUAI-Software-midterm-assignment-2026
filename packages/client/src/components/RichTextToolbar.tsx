import type { Editor } from "@tiptap/react";

interface ToolbarButtonProps {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

function ToolbarButton({ active = false, disabled = false, label, onClick }: ToolbarButtonProps) {
  return (
    <button
      className={`toolbar-button${active ? " active" : ""}`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function RichTextToolbar({
  editor,
  disabled
}: {
  editor: Editor | null;
  disabled: boolean;
}) {
  if (!editor) {
    return null;
  }

  const isDisabled = disabled || !editor.isEditable;

  return (
    <div className="toolbar">
      <ToolbarButton
        label="H1"
        disabled={isDisabled}
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolbarButton
        label="H2"
        disabled={isDisabled}
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        label="Bold"
        disabled={isDisabled}
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="Italic"
        disabled={isDisabled}
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label="Bullets"
        disabled={isDisabled}
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Numbers"
        disabled={isDisabled}
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        label="Code"
        disabled={isDisabled}
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
    </div>
  );
}
