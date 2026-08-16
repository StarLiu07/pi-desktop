// Mock Tauri IPC for plain-browser visual verification of the Pi Desktop
// shell (sidebars, folder icons, etc.). Loaded via agent-browser --init-script
// BEFORE the app bundles run, so init() believes pi is installed and the main
// shell renders with fake sessions/projects.
//
// Tauri v2 plumbing this mock must replicate:
//   invoke()            -> window.__TAURI_INTERNALS__.invoke(cmd, args, opts)
//   transformCallback() -> stores cb, returns id; backend fires window['_'+id]
//   listen()            -> invoke('plugin:event|listen', {event, handler:id})
//                          then the backend event loop calls the registered
//                          callback with { event, payload, id }.
(() => {
  const listeners = {};        // event name -> handler fn (expects {event, payload})
  let cbSeq = 0;

  const emit = (event, payload) => {
    const cb = listeners[event];
    if (cb) {
      try { cb({ event, payload, id: cbSeq }); } catch (e) { console.error('[mock-tauri] handler error', e); }
    }
  };

  const SESSIONS = [
    // group: D:\pi-desktop (current project) — 6 rows, one beyond preview
    { id: 's1', name: '侧边栏文件夹图标', preview: '让项目图标灵动一点', timestamp: new Date(Date.now() - 5 * 60_000).toISOString(), cwd: 'D:\\pi-desktop', message_count: 24, file: 'a.md', path: 'C:/pi/sessions/a.md', last_message_id: 'm1' },
    { id: 's2', name: '修复输入栏焦点', preview: 'focus 丢失', timestamp: new Date(Date.now() - 3 * 3_600_000).toISOString(), cwd: 'D:\\pi-desktop', message_count: 11, file: 'b.md', path: 'C:/pi/sessions/b.md', last_message_id: 'm2' },
    { id: 's3', name: '状态栏用量统计', preview: 'token 用量', timestamp: new Date(Date.now() - 26 * 3_600_000).toISOString(), cwd: 'D:\\pi-desktop', message_count: 8, file: 'c.md', path: 'C:/pi/sessions/c.md', last_message_id: 'm3' },
    { id: 's4', name: null, preview: '窗口拖拽区域调试', timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(), cwd: 'D:\\pi-desktop', message_count: 5, file: 'd.md', path: 'C:/pi/sessions/d.md', last_message_id: null },
    { id: 's5', name: '清理旧会话归档', preview: null, timestamp: new Date(Date.now() - 4 * 86_400_000).toISOString(), cwd: 'D:\\pi-desktop', message_count: 3, file: 'e.md', path: 'C:/pi/sessions/e.md', last_message_id: null },
    { id: 's6', name: '主题色微调', preview: null, timestamp: new Date(Date.now() - 6 * 86_400_000).toISOString(), cwd: 'D:\\pi-desktop', message_count: 2, file: 'f.md', path: 'C:/pi/sessions/f.md', last_message_id: null },
    // group: C:\dev\zcode
    { id: 'z1', name: 'zcode 面板重做', preview: null, timestamp: new Date(Date.now() - 9 * 86_400_000).toISOString(), cwd: 'C:\\dev\\zcode', message_count: 17, file: 'z1.md', path: 'C:/pi/sessions/z1.md', last_message_id: null },
    { id: 'z2', name: null, preview: '快捷键冲突排查', timestamp: new Date(Date.now() - 12 * 86_400_000).toISOString(), cwd: 'C:\\dev\\zcode', message_count: 4, file: 'z2.md', path: 'C:/pi/sessions/z2.md', last_message_id: null },
    // ungrouped (no cwd)
    { id: 'u1', name: null, preview: '闲聊：什么是 agent loop', timestamp: new Date(Date.now() - 30 * 3_600_000).toISOString(), cwd: null, message_count: 9, file: 'u1.md', path: 'C:/pi/sessions/u1.md', last_message_id: null },
  ];

  const MODEL = {
    id: 'deepseek-v4', name: 'deepseek-v4', api: 'deepseek', provider: 'DeepSeek',
    reasoning: true, input: ['text'], output: ['text'],
  };

  const reply = (req, data) => {
    setTimeout(() => {
      emit('pi-event', {
        id: req.id, type: 'response', command: req.type, success: true, data,
      });
    }, 30);
  };

  window.__TAURI_INTERNALS__ = {
    transformCallback: (callback, once = false) => {
      const id = ++cbSeq;
      window['_' + id] = (event) => {
        callback(event);
        if (once) delete window['_' + id];
      };
      return id;
    },
    unregisterCallback: (id) => { delete window['_' + id]; },
    invoke: (cmd, args = {}) => {
      switch (cmd) {
        case 'plugin:event|listen': {
          const handlerFn = window['_' + args.handler];
          listeners[args.event] = (ev) => handlerFn(ev);
          return Promise.resolve(++cbSeq); // eventId
        }
        case 'plugin:event|unlisten':
          return Promise.resolve();
        case 'pi_installed':
          return Promise.resolve(true);
        case 'send_rpc': {
          const req = args.request || {};
          if (req.type === 'get_state') {
            reply(req, {
              sessionId: 's1', sessionFile: 'C:/pi/sessions/a.md', sessionName: '侧边栏文件夹图标',
              model: MODEL, thinkingLevel: 'medium',
            });
          } else if (req.type === 'get_available_models') {
            reply(req, { models: [MODEL] });
          } else {
            reply(req, {});
          }
          return Promise.resolve();
        }
        case 'list_sessions':
          return Promise.resolve(SESSIONS);
        case 'list_projects':
          return Promise.resolve({
            current: 'D:\\pi-desktop',
            recent: ['D:\\pi-desktop', 'C:\\dev\\zcode', 'C:\\dev\\opencode'],
          });
        case 'stop_pi':
        case 'start_pi':
          return Promise.resolve();
        case 'set_project':
        case 'create_project_dir':
          return Promise.resolve(null);
        case 'pick_project':
          return Promise.resolve(null);
        case 'project_path_info':
          return Promise.resolve({ exists: true, is_dir: true });
        case 'name_sessions':
          return Promise.resolve([]);
        default:
          return Promise.resolve(null);
      }
    },
    event: { emit },
    plugins: {},
    metadata: {},
  };
  console.log('[mock-tauri] __TAURI_INTERNALS__ installed');
})();
