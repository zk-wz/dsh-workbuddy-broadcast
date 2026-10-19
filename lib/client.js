/**
 * Settings page for WorkBuddy Broadcast.
 *
 * Renders one page in `settings.section`. It owns no Host Remote binding: the
 * page reads its status from, and writes its configuration to, the plugin's
 * own loopback route, which the Host half registers on the Harness Web
 * server. Styling uses only `--dsw-alias-*` theme tokens so the page follows
 * the host theme in light and dark.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workbuddy-broadcast',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const BASE = '/plugins/dsh-workbuddy-broadcast';
    const STATUS_PATH = `${BASE}/status`;
    const CONFIG_PATH = `${BASE}/config`;

    /**
     * Where the WSL helper script lives.
     *
     * It is deliberately not shipped in the npm tarball: it is useful only to
     * Windows+WSL users, and bundling it would inflate every install by about
     * two thirds for a file the other platforms never touch. The settings page
     * links here instead.
     */
    const SCRIPT_URL =
      'https://github.com/zk-wz/dsh-workbuddy-broadcast/blob/main/scripts/wb-bridge';

    const POLL_MS = 5000;

    /** Minimal inline dictionary; the page is small enough not to need files. */
    const DICT = {
      zh: {
        title: 'WorkBuddy 广播',
        description: '供 WSL 内的 agent 工具使用的 OpenAI 兼容端点。',
        listening: '监听中',
        starting: '启动中',
        noCredential: '未登录 WorkBuddy',
        error: '启动失败',
        endpoint: 'WSL 端点',
        endpointLocal: '本机端点',
        apiKey: 'API Key',
        port: '监听端口',
        models: '模型数',
        veth: 'vEthernet 地址',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        copy: '复制',
        copied: '已复制',
        refresh: '刷新',
        notStarted: '尚未启动',
        keyGenerated: '临时生成（未保存）',
        keyConfigured: '已配置',
        restartNote: '端口或 Key 改动后需重启插件生效。',
        hintWsl: 'WSL：先在 GitHub 下载 wb-bridge 脚本并执行 wb-bridge start，工具指向 http://127.0.0.1:{port}/v1',
        scriptLink: '下载 wb-bridge 脚本',
        
        hintNoWsl: '本机没有 WSL 虚拟网卡（可能未安装 WSL），因此只监听本机地址。这不影响 Windows 上的使用。',
        hintNotWindows: '本平台没有 WSL 虚拟网卡（该网卡只存在于 Windows），因此只监听本机地址。',
        hintWin: '本机：工具指向 http://localhost:{port}/v1',
        wslUnavailable: '未检测到 WSL 网卡',
        portInvalid: '端口需为 1-65535 的整数',
        effortTitle: '推理强度（reasoning_effort）',
        effortDesc: '该参数会原样透传给上游。下表为各模型声称支持的档位。',
        effortUnspecified: '未声明',
        tagImages: '图片',
        tagReasoning: '推理',
        modelPickTitle: '选择模型',
        modelPickDesc: '勾选的模型会出现在下方提示词中，顺序与上方列表一致。',
        promptTitle: '配置提示词',
        promptDesc: '把这段发给要接入的 Agent 即可，内容会随上面的选择和配置实时变化。',
        copyPrompt: '复制提示词',

      },
      en: {
        title: 'WorkBuddy Broadcast',
        description: 'An OpenAI-compatible endpoint for agent tools running inside WSL.',
        listening: 'Listening',
        starting: 'Starting',
        noCredential: 'Not signed in',
        error: 'Failed',
        endpoint: 'WSL endpoint',
        endpointLocal: 'Local endpoint',
        apiKey: 'API key',
        port: 'Port',
        models: 'Models',
        veth: 'vEthernet address',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        copy: 'Copy',
        copied: 'Copied',
        refresh: 'Refresh',
        notStarted: 'Not started',
        keyGenerated: 'Generated (not saved)',
        keyConfigured: 'Configured',
        restartNote: 'Restart the plugin after changing the port or key.',
        hintWsl: 'WSL: download the wb-bridge script from GitHub, run wb-bridge start, then point tools at http://127.0.0.1:{port}/v1',
        scriptLink: 'Download the wb-bridge script',
        
        hintNoWsl: 'No WSL virtual adapter found (WSL may not be installed), so only the local address is listening. This does not affect use on Windows.',
        hintNotWindows: 'The WSL virtual adapter only exists on Windows, so this host listens locally only.',
        hintWin: 'Local: point tools at http://localhost:{port}/v1',
        wslUnavailable: 'No WSL adapter detected',
        portInvalid: 'Port must be an integer from 1 to 65535',
        effortTitle: 'Reasoning effort (reasoning_effort)',
        effortDesc: 'Passed through to the upstream unchanged. The table lists the levels each model declares.',
        effortUnspecified: 'unspecified',
        tagImages: 'image',
        tagReasoning: 'reasoning',
        modelPickTitle: 'Select models',
        modelPickDesc: 'Tick the models to include in the prompt below. They appear in the same order as this list.',
        promptTitle: 'Configuration prompt',
        promptDesc: 'Send this to the agent you are connecting. It updates as you change the selection and settings above.',
        copyPrompt: 'Copy prompt',

      },
    };

    const s = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 20, padding: '4px 0' },
      head: { display: 'flex', flexDirection: 'column', gap: 6 },
      title: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: 0 },
      desc: {
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-secondary)',
        margin: 0,
      },
      card: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
        overflow: 'hidden',
      },
      row: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        padding: '12px 14px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      rowFirst: { display: 'flex', alignItems: 'flex-start', gap: 16, padding: '12px 14px' },
      label: {
        flex: '0 0 132px',
        fontSize: 13,
        color: 'var(--dsw-alias-label-secondary)',
        lineHeight: '20px',
      },
      value: {
        flex: '1 1 auto',
        minWidth: 0,
        fontSize: 13,
        color: 'var(--dsw-alias-label-primary)',
        lineHeight: '20px',
        wordBreak: 'break-all',
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
      dot: (color) => ({
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        marginRight: 8,
        verticalAlign: 'middle',
        flex: '0 0 auto',
      }),
      button: {
        fontSize: 12,
        lineHeight: '20px',
        padding: '2px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        // A flex parent would otherwise shrink this control until its label
        // wraps; keep the button at its natural width and never break a word.
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
        wordBreak: 'keep-all',
      },
      primary: {
        fontSize: 12,
        lineHeight: '20px',
        padding: '2px 12px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))',
        background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary))',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
        cursor: 'pointer',
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
        wordBreak: 'keep-all',
      },
      input: {
        fontSize: 13,
        lineHeight: '20px',
        padding: '3px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        width: '100%',
        boxSizing: 'border-box',
      },
      hint: {
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        padding: '10px 12px',
      },
      link: {
        color: 'var(--dsw-alias-brand-primary)',
        textDecoration: 'none',
        marginLeft: 4,
      },
      /** The copy-ready paragraph: preformatted, wrapped, and selectable. */
      prompt: {
        margin: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 8,
        padding: '12px 14px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflowX: 'auto',
      },
      error: { fontSize: 13, color: 'var(--dsw-alias-state-error-primary)', lineHeight: '20px' },
      note: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: '20px' },
    };

    function statusColor(status) {
      if (status === 'listening') return 'var(--dsw-alias-state-success-primary)';
      if (status === 'error') return 'var(--dsw-alias-state-error-primary)';
      if (status === 'starting') return 'var(--dsw-alias-state-warn-primary)';
      return 'var(--dsw-alias-state-idle-primary)';
    }

    function CopyButton(props) {
      const [done, setDone] = React.useState(false);
      const timer = React.useRef(undefined);
      React.useEffect(
        () => () => {
          if (timer.current !== undefined) clearTimeout(timer.current);
        },
        [],
      );
      const onClick = async () => {
        try {
          await navigator.clipboard.writeText(props.text);
          setDone(true);
          if (timer.current !== undefined) clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1200);
        } catch {
          // Clipboard permission denied: leave the label unchanged.
        }
      };
      return h(
        'button',
        { type: 'button', style: { ...s.button, marginLeft: 8 }, onClick },
        done ? props.copiedLabel : props.copyLabel,
      );
    }

    function Row(props) {
      return h(
        'div',
        { style: props.first ? s.rowFirst : s.row },
        h('div', { style: s.label }, props.label),
        h('div', { style: s.value }, props.children),
      );
    }

    /** Format a token count the way a person reads it (1M, 128K). */
    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
      if (value >= 1000000) {
        const millions = value / 1000000;
        return `${Number.isInteger(millions) ? millions : millions.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}M`;
      }
      if (value >= 1000) {
        const thousands = value / 1000;
        return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
      }
      return String(value);
    }

    /**
     * One line of model capability, as shown in the picker.
     *
     * Only facts the catalog declared are printed; anything absent is left
     * out rather than guessed, so a row never promises a capability the
     * upstream did not report.
     */
    function describeModel(model, t) {
      const parts = [];
      const context = formatTokens(model.contextWindow);
      const output = formatTokens(model.maxTokens);
      if (context !== undefined) parts.push(`${context} ctx`);
      if (output !== undefined) parts.push(`${output} out`);
      if (model.supportsImages === true) parts.push(t.tagImages);
      if (model.supportsReasoning === true) {
        parts.push(
          model.efforts.length > 0
            ? `${t.tagReasoning} ${model.efforts.join('/')}`
            : t.tagReasoning,
        );
      }
      return parts.length > 0 ? parts.join(' · ') : t.effortUnspecified;
    }

    /**
     * English copy for the copy-ready prompt.
     *
     * Deliberately *not* part of `DICT`: the paragraph is meant to be pasted
     * into another agent's chat, where the user's UI language is irrelevant
     * and English is the safest default. Keeping it separate also stops the
     * prompt from silently changing language with the settings page.
     */
    const PROMPT = {
      intro: 'Help me configure an OpenAI-compatible model service. Details:',
      baseUrl: '**Base URL**',
      apiKey: '**API Key**',
      modelId: '**Model ID**',
      apiFormat: '**API format**',
      protocol: '- Standard OpenAI Chat Completions protocol',
      request:
        '- Request: `POST /v1/chat/completions` with `Authorization: Bearer <key>` and `Content-Type: application/json`',
      stream:
        '- **Streaming is required (`"stream": true`, SSE)** — this service only emits SSE; it does not return a single complete response',
      noModel: '(no model selected — tick one in the Model Selection section)',
      missingKey: '(not generated yet — see the API Key field above)',
      lookupFooter:
        'Note: where a model\'s context window or capabilities are not listed above, please look them up yourself.',
      lookupInline: 'capabilities vary — please verify before use',
    };

    /**
     * Render the copy-ready configuration paragraph.
     *
     * Every substituted value comes from the live catalog or the running
     * listener. When a fact is missing it is omitted from the model line and
     * the footer tells the agent to look it up, which is honest: the plugin
     * cannot know a capability the upstream never declared.
     */
    function buildPrompt(input) {
      const { baseUrl, apiKey, models } = input;
      const showKey = apiKey !== '' ? apiKey : PROMPT.missingKey;

      const modelLines =
        models.length > 0
          ? models.map((model) => {
              const details = [];
              const context = formatTokens(model.contextWindow);
              const output = formatTokens(model.maxTokens);
              if (context !== undefined) details.push(`context window ${context} tokens`);
              if (output !== undefined) details.push(`max output ${output} tokens`);
              if (model.supportsImages === true) details.push('supports image input');
              if (model.supportsReasoning === true) {
                details.push(
                  model.efforts.length > 0
                    ? `supports reasoning_effort (${model.efforts.join(' / ')})`
                    : 'supports reasoning_effort',
                );
              }
              return details.length > 0
                ? `${model.id}  # ${details.join(', ')}`
                : `${model.id}  # ${PROMPT.lookupInline}`;
            })
          : [PROMPT.noModel];

      return [
        PROMPT.intro,
        '',
        PROMPT.baseUrl,
        '',
        '```',
        baseUrl,
        '```',
        '',
        PROMPT.apiKey,
        '',
        '```',
        showKey,
        '```',
        '',
        PROMPT.modelId,
        '',
        '```',
        ...modelLines,
        '```',
        '',
        PROMPT.apiFormat,
        '',
        PROMPT.protocol,
        PROMPT.request,
        PROMPT.stream,
        '',
        PROMPT.lookupFooter,
      ].join('\n');
    }

    function BroadcastSection(props) {
      const lang = props.lang ?? 'en';
      const t = DICT[lang] ?? DICT.en;
      const [doc, setDoc] = React.useState(undefined);
      const [failure, setFailure] = React.useState(undefined);
      const [busy, setBusy] = React.useState(false);
      const [portDraft, setPortDraft] = React.useState('');
      const [keyDraft, setKeyDraft] = React.useState('');
      const [saving, setSaving] = React.useState(false);
      const [savedOnce, setSavedOnce] = React.useState(false);
      const [formError, setFormError] = React.useState(undefined);
      /** Model ids ticked in the picker; drives the prompt template. */
      const [selected, setSelected] = React.useState(() => new Set());
      const [promptCopied, setPromptCopied] = React.useState(false);
      const seq = React.useRef(0);
      const seeded = React.useRef(false);

      const refresh = React.useCallback(async (signal) => {
        const mine = ++seq.current;
        try {
          const response = await fetch(STATUS_PATH, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            ...(signal === undefined ? {} : { signal }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const value = await response.json();
          if (mine !== seq.current) return;
          setDoc(value);
          setFailure(undefined);
          // Seed the editable fields once, so a poll cannot overwrite what
          // the user is currently typing.
          if (!seeded.current) {
            seeded.current = true;
            setPortDraft(String(value.port ?? 18731));
          }
        } catch (error) {
          if (signal?.aborted === true) return;
          if (mine !== seq.current) return;
          setFailure(error instanceof Error ? error.message : String(error));
        }
      }, []);

      React.useEffect(() => {
        const controller = new AbortController();
        refresh(controller.signal);
        const timer = setInterval(() => {
          refresh(controller.signal);
        }, POLL_MS);
        return () => {
          clearInterval(timer);
          controller.abort();
        };
      }, [refresh]);

      const onRefresh = async () => {
        setBusy(true);
        try {
          await refresh(undefined);
        } finally {
          setBusy(false);
        }
      };

      const onSave = async () => {
        setFormError(undefined);
        const port = Number(portDraft);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          setFormError(t.portInvalid);
          return;
        }
        setSaving(true);
        try {
          const payload = { port };
          // Only send the key when the user actually typed one, so an empty
          // box never clears a saved key.
          if (keyDraft.trim() !== '') payload.apiKey = keyDraft.trim();
          const response = await fetch(CONFIG_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            const detail = await response.json().catch(() => undefined);
            throw new Error(detail?.error ?? `HTTP ${response.status}`);
          }
          setKeyDraft('');
          setSavedOnce(true);
          await refresh(undefined);
        } catch (error) {
          setFormError(error instanceof Error ? error.message : String(error));
        } finally {
          setSaving(false);
        }
      };

      const status = doc?.status ?? 'starting';
      const label =
        status === 'listening'
          ? t.listening
          : status === 'no-credential'
            ? t.noCredential
            : status === 'error'
              ? t.error
              : t.starting;

      // The Host reports the two surfaces separately: `wsl` is absent on a
      // machine without WSL, and `local` is the loopback listener. Neither is
      // guaranteed, so every read here stays optional.
      const wsl = doc?.wsl;
      const hasLocal = doc?.local === true;
      const endpoint = wsl ? `http://${wsl.address}:${wsl.port}/v1` : undefined;
      const port = doc?.port ?? 18731;
      const localEndpoint = `http://localhost:${port}/v1`;
      const veth = Array.isArray(doc?.veth) && doc.veth.length > 0 ? doc.veth[0].address : undefined;
      const keySourceLabel = doc?.apiKeySource === 'config' ? t.keyConfigured : t.keyGenerated;
      const models = Array.isArray(doc?.modelEfforts) ? doc.modelEfforts : [];

      /** Tick or untick one model in the prompt builder. */
      const toggleModel = (id) => {
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };

      // The prompt talks to an agent on the user's own machine (English, as
      // requested), so it names the endpoint the *user* will use: the local
      // one when it exists, the WSL one otherwise.
      const baseUrl = `http://localhost:${port}/v1`;
      const promptText = buildPrompt({
        baseUrl,
        apiKey: doc?.apiKey ?? '',
        // Keep catalog order rather than click order, so the paragraph reads
        // the same way regardless of how the boxes were ticked.
        models: models.filter((model) => selected.has(model.id)),
      });

      return h(
        'div',
        { style: s.wrap },
        h(
          'div',
          { style: s.head },
          h('h3', { style: s.title }, t.title),
          h('p', { style: s.desc }, t.description),
        ),
        h(
          'div',
          { style: s.card },
          h(
            Row,
            { first: true, label: '' },
            h('span', { style: s.dot(statusColor(status)) }),
            h('span', null, label),
            h(
              'button',
              { type: 'button', style: { ...s.button, marginLeft: 12 }, onClick: onRefresh },
              busy ? '…' : t.refresh,
            ),
          ),
          h(
            Row,
            { label: t.endpoint },
            h(
              'span',
              { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
              h(
                'span',
                {
                  style: {
                    ...s.mono,
                    minWidth: 0,
                    wordBreak: 'break-all',
                    ...(endpoint ? {} : { color: 'var(--dsw-alias-label-secondary)' }),
                  },
                },
                endpoint ?? t.wslUnavailable,
              ),
              endpoint
                ? h(CopyButton, { text: endpoint, copyLabel: t.copy, copiedLabel: t.copied })
                : null,
            ),
          ),
          hasLocal
            ? h(
                Row,
                { label: t.endpointLocal },
                h(
                  'span',
                  { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
                  h(
                    'span',
                    { style: { ...s.mono, minWidth: 0, wordBreak: 'break-all' } },
                    localEndpoint,
                  ),
                  h(CopyButton, {
                    text: localEndpoint,
                    copyLabel: t.copy,
                    copiedLabel: t.copied,
                  }),
                ),
              )
            : null,
          veth ? h(Row, { label: t.veth }, h('span', { style: s.mono }, veth)) : null,
          h(
            Row,
            { label: t.port },
            h('input', {
              type: 'text',
              value: portDraft,
              onChange: (event) => setPortDraft(event.target.value),
              style: { ...s.input, maxWidth: 140 },
              'aria-label': t.port,
            }),
          ),
          h(
            Row,
            { label: t.apiKey },
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
                // The key itself may break anywhere (it is one long token), but
                // that rule must not reach the button beside it.
                h(
                  'span',
                  { style: { ...s.mono, minWidth: 0, wordBreak: 'break-all' } },
                  doc?.apiKey ?? '—',
                ),
                doc?.apiKey
                  ? h(CopyButton, {
                      text: doc.apiKey,
                      copyLabel: t.copy,
                      copiedLabel: t.copied,
                    })
                  : null,
              ),
              h('div', { style: s.note }, keySourceLabel),
              h('input', {
                type: 'password',
                value: keyDraft,
                placeholder: 'sk-wb-…',
                onChange: (event) => setKeyDraft(event.target.value),
                style: s.input,
                'aria-label': t.apiKey,
              }),
            ),
          ),
          h(
            Row,
            { label: '' },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 10, width: '100%' } },
              h(
                'button',
                { type: 'button', style: s.primary, onClick: onSave, disabled: saving },
                saving ? t.saving : savedOnce ? t.saved : t.save,
              ),
              h('span', { style: s.note }, t.restartNote),
            ),
          ),
        ),
        formError ? h('div', { style: s.error }, formError) : null,
        failure ? h('div', { style: s.error }, failure) : null,
        status === 'error' && doc?.message ? h('div', { style: s.error }, doc.message) : null,
        // A missing WSL adapter is normal — either WSL is not installed on
        // Windows, or the host is not Windows at all. The two get different
        // wording so macOS and Linux users are not told to install WSL.
        doc?.wsl === null && status === 'listening'
          ? h(
              'div',
              { style: s.hint },
              typeof doc?.wslError === 'string' && doc.wslError.includes('only exists on Windows')
                ? t.hintNotWindows
                : t.hintNoWsl,
            )
          : null,
        // Each hint appears only when the surface it describes is listening.
        hasLocal ? h('div', { style: s.hint }, t.hintWin.replace('{port}', String(port))) : null,
        wsl
          ? h(
              'div',
              { style: s.hint },
              t.hintWsl.replace('{port}', String(port)),
              h(
                'a',
                {
                  href: SCRIPT_URL,
                  target: '_blank',
                  rel: 'noreferrer noopener',
                  style: s.link,
                },
                t.scriptLink,
              ),
            )
          : null,
        models.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              h('div', { style: s.title }, t.modelPickTitle),
              h('p', { style: s.desc }, t.modelPickDesc),
              h(
                'div',
                { style: s.card },
                models.map((model, index) =>
                  h(
                    'label',
                    {
                      key: model.id,
                      style: {
                        ...(index === 0 ? s.rowFirst : s.row),
                        alignItems: 'center',
                        cursor: 'pointer',
                      },
                    },
                    h('input', {
                      type: 'checkbox',
                      checked: selected.has(model.id),
                      onChange: () => toggleModel(model.id),
                      style: { margin: 0, cursor: 'pointer', flex: '0 0 auto' },
                    }),
                    h(
                      'div',
                      { style: { ...s.value, ...s.mono, flex: '1 1 40%', marginLeft: 4 } },
                      model.id,
                    ),
                    h(
                      'div',
                      { style: { ...s.label, flex: '0 1 auto', textAlign: 'right' } },
                      describeModel(model, t),
                    ),
                  ),
                ),
              ),
            )
          : null,
        // The prompt block sits between the model picker and the effort table:
        // the user picks models above, then copies the paragraph below.
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('div', { style: s.title }, t.promptTitle),
            h(
              'button',
              {
                type: 'button',
                style: s.button,
                onClick: () => {
                  void navigator.clipboard
                    ?.writeText(promptText)
                    .then(() => {
                      setPromptCopied(true);
                      window.setTimeout(() => setPromptCopied(false), 1200);
                    })
                    .catch(() => undefined);
                },
              },
              promptCopied ? t.copied : t.copyPrompt,
            ),
          ),
          h('p', { style: s.desc }, t.promptDesc),
          h('pre', { style: s.prompt }, promptText),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.locale.register('dsh-workbuddy-broadcast', {
              zh: DICT.zh,
              en: DICT.en,
            }),
          'dsh-workbuddy-broadcast: locale',
        );

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'workbuddy-broadcast',
              order: 30,
              label: () => (ctx.locale.getLocale().id === 'zh' ? DICT.zh.title : DICT.en.title),
            },
            (props) =>
              h(BroadcastSection, {
                ...props,
                lang: ctx.locale.getLocale().id === 'zh' ? 'zh' : 'en',
              }),
          ),
        );
      },
    };
  },
});
