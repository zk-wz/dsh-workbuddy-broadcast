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
        hintWsl: 'WSL：执行 wb-bridge start，工具指向 http://127.0.0.1:{port}/v1',
        
        hintNoWsl: '本机没有 WSL 虚拟网卡（可能未安装 WSL），因此只监听本机地址。这不影响 Windows 上的使用。',
        hintNotWindows: '本平台没有 WSL 虚拟网卡（该网卡只存在于 Windows），因此只监听本机地址。',
        hintWin: '本机：工具指向 http://localhost:{port}/v1',
        wslUnavailable: '未检测到 WSL 网卡',
        portInvalid: '端口需为 1-65535 的整数',
        effortTitle: '推理强度（reasoning_effort）',
        effortDesc: '该参数会原样透传给上游。下表为各模型声称支持的档位。',
        effortUnspecified: '未声明',
      },
      en: {
        title: 'WorkBuddy Broadcast',
        description: 'An OpenAI-compatible endpoint for agent tools running inside WSL.',
        listening: 'Listening',
        starting: 'Starting',
        noCredential: 'Not signed in',
        error: 'Failed',
        endpoint: 'Endpoint',
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
        hintWsl: 'WSL: run wb-bridge start, then point tools at http://127.0.0.1:{port}/v1',
        
        hintNoWsl: 'No WSL virtual adapter found (WSL may not be installed), so only the local address is listening. This does not affect use on Windows.',
        hintNotWindows: 'The WSL virtual adapter only exists on Windows, so this host listens locally only.',
        hintWin: 'Local: point tools at http://localhost:{port}/v1',
        wslUnavailable: 'No WSL adapter detected',
        portInvalid: 'Port must be an integer from 1 to 65535',
        effortTitle: 'Reasoning effort (reasoning_effort)',
        effortDesc: 'Passed through to the upstream unchanged. The table lists the levels each model declares.',
        effortUnspecified: 'unspecified',
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
        wsl ? h('div', { style: s.hint }, t.hintWsl.replace('{port}', String(port))) : null,
        models.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              h('div', { style: s.title }, t.effortTitle),
              h('p', { style: s.desc }, t.effortDesc),
              h(
                'div',
                { style: s.card },
                models.map((model, index) =>
                  h(
                    'div',
                    {
                      key: model.id,
                      style: {
                        ...(index === 0 ? s.rowFirst : s.row),
                        alignItems: 'center',
                      },
                    },
                    h(
                      'div',
                      { style: { ...s.value, ...s.mono, flex: '1 1 40%' } },
                      model.id,
                    ),
                    h(
                      'div',
                      { style: { ...s.label, flex: '1 1 auto', textAlign: 'right' } },
                      model.efforts.length > 0 ? model.efforts.join(' / ') : t.effortUnspecified,
                    ),
                  ),
                ),
              ),
            )
          : null,
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
