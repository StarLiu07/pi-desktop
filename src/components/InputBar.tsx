import { useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { Selector, type SelectorOption } from './Selector';
import { modelKey, modelOptions, thinkingOptions } from '../lib/selectors';

/** Last path segment of an absolute path (`D:\a\b` → `b`). */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** A file attached to the next prompt (read client-side, size-capped). */
interface AttachedFile {
  name: string;
  size: number;
  content: string;
  truncated: boolean;
}

/** Per-file cap for content pasted into the prompt, in bytes. */
const MAX_ATTACH_BYTES = 200_000;

export function InputBar() {
  const status = useStore((s) => s.status);
  const agentActive = useStore((s) => s.tabs[s.activeTabIndex]?.agentActive);
  const sendPrompt = useStore((s) => s.sendPrompt);
  const abort = useStore((s) => s.abort);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentProject = useStore((s) => s.currentProject);
  const recentProjects = useStore((s) => s.recentProjects);
  const setProject = useStore((s) => s.setProject);

  const currentModel = useStore((s) => s.currentModel);
  const models = useStore((s) => s.models);
  const setModel = useStore((s) => s.setModel);
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const setThinkingLevel = useStore((s) => s.setThinkingLevel);

  const thinkingDisabled = !!currentModel && !currentModel.reasoning;

  const projectOptions: SelectorOption[] = [
    {
      value: '',
      label: '无项目',
      hint: '对话不绑定文件夹',
    },
    ...recentProjects.map((p) => ({
      value: p,
      label: baseName(p),
      hint: p,
      group: '最近项目',
    })),
  ];

  // No auto-focus on mount: focusing the textarea right as the window appears
  // wakes the IME, and some IMEs (WeType) pop a candidate window over the app
  // — users read it as a stray "black window". Clicking the box focuses it.

  const submit = () => {
    const trimmed = text.trim();
    const hasFiles = attachments.length > 0;
    if ((!trimmed && !hasFiles) || agentActive || status !== 'ready') return;
    // Attached files travel inside the message: one block per file, then the
    // user's own text. Content is capped client-side (see MAX_ATTACH_BYTES).
    const fileBlocks = attachments
      .map(
        (a) =>
          `【文件：${a.name}${a.truncated ? '（内容过长，已截取前一部分）' : ''}】\n${a.content}`,
      )
      .join('\n\n');
    const message = fileBlocks ? (trimmed ? `${fileBlocks}\n\n${trimmed}` : fileBlocks) : trimmed;
    sendPrompt(message);
    setText('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  /** Read picked files (size-capped) into attachment chips. */
  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Allow re-picking the same file later (clearing resets the input).
    e.target.value = '';
    if (files.length === 0) return;
    const loaded = await Promise.all(
      files.map(async (f): Promise<AttachedFile> => {
        const truncated = f.size > MAX_ATTACH_BYTES;
        const blob = truncated ? f.slice(0, MAX_ATTACH_BYTES) : f;
        return { name: f.name, size: f.size, content: await blob.text(), truncated };
      }),
    );
    setAttachments((prev) => [...prev, ...loaded]);
  };

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  return (
    <div className="inputbar">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="file-input"
        onChange={onPickFiles}
      />
      <div className="inputbox">
        <div className="inputbox-tools">
          <Selector
            className="project-select"
            options={projectOptions}
            value={currentProject ?? ''}
            onChange={setProject}
            title={currentProject ? `项目：${currentProject}` : '无项目（对话不绑定文件夹）'}
          >
            <span className="sel-icon">📁</span>
            <span className="sel-name">
              {/* 「无项目」 vs 「选择项目」:recent 非空说明用户主动切到无项目 */}
              {currentProject
                ? baseName(currentProject)
                : recentProjects.length > 0
                  ? '无项目'
                  : '选择项目'}
            </span>
          </Selector>
        </div>
        {attachments.length > 0 && (
          <div className="inputbox-attachments">
            {attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="attach-chip" title={a.name}>
                <span className="attach-chip-name">
                  📎 {a.name}
                  {a.truncated && <span className="attach-trunc">（已截取）</span>}
                </span>
                <button
                  type="button"
                  className="attach-x"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  title="移除"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="inputbox-main">
          <span className="prompt">&gt;</span>
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder="输入消息…"
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={(e) => {
              // isComposing: IME 输入法确认候选词也触发 Enter,不能提交
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        {/* ChatGPT-web style: thinking level, model and send live on their own
            toolbar row below the textarea instead of crowding the input line. */}
        <div className="inputbox-actions">
          <button
            type="button"
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={agentActive}
            title="添加文件"
          >
            +
          </button>
          <Selector
            className="inputbox-select"
            options={thinkingOptions(currentModel)}
            value={thinkingLevel}
            onChange={setThinkingLevel}
            disabled={thinkingDisabled}
            title={thinkingDisabled ? '当前模型不支持思考' : '思考强度'}
          >
            <span className="sel-icon">⚡</span>
            <span className="sel-name">{thinkingLevel}</span>
          </Selector>
          <Selector
            className="inputbox-select"
            options={modelOptions(models)}
            value={currentModel ? modelKey(currentModel) : ''}
            onChange={setModel}
            title={currentModel ? `${currentModel.name} · ${currentModel.provider}` : '切换模型'}
            alignRight
          >
            <span className="sel-name">{currentModel?.name ?? '选择模型'}</span>
            {currentModel?.provider && (
              <span className="sel-prov">{currentModel.provider}</span>
            )}
          </Selector>
          {agentActive ? (
            <button className="stop-btn" onClick={() => abort()}>
              ■ 停止
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={submit}
              disabled={(!text.trim() && attachments.length === 0) || status !== 'ready'}
              title="发送"
            >
              →
            </button>
          )}
        </div>
      </div>
      <div className="input-hint">
        <span className="input-hint-text">
          {agentActive ? 'agent 运行中，可随时停止' : 'Enter 发送 · Shift+Enter 换行 · 双击标签重命名'}
        </span>
      </div>
    </div>
  );
}
