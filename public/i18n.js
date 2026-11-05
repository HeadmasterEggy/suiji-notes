// Interface language. The Chinese text is the key and stays the source; EN gives its English.
// "suiji:lang" holds the choice ("zh" / "en"); without one the browser's language decides.
// t("…{n}…", { n }) fills placeholders. translatePage() swaps fixed text in index.html at load.
let saved = null;
try { saved = localStorage.getItem("suiji:lang"); } catch {}
export const langChoice = saved === "zh" || saved === "en" ? saved : "";
export const lang = langChoice || (/^zh\b/i.test(navigator.language || "") ? "zh" : "en");

const EN = {
  // page
  "随记": "Suiji",
  "连接中…": "Connecting…",
  "图谱": "Graph",
  "搜索": "Search",
  "新建": "New",
  "上传": "Upload",
  "上传文件夹": "Upload folder",
  "排序": "Sort",
  "名称 A→Z": "Name A→Z",
  "名称 Z→A": "Name Z→A",
  "从新到旧": "Newest first",
  "从旧到新": "Oldest first",
  "设置": "Settings",
  "调整侧边栏宽度": "Resize the sidebar",
  "拖动调整宽度，双击恢复": "Drag to resize, double-click to reset",
  "松开即可上传到随记": "Drop to upload to Suiji",
  "在手机和电脑上登录同一个账号，笔记就会自动同步。": "Sign in with the same account on your phone and computer, and your notes sync by themselves.",
  "邮箱": "Email",
  "密码": "Password",
  "登录": "Sign in",
  "注册": "Sign up",
  "还没有账号？注册": "No account yet? Sign up",
  "已有账号？登录": "Have an account? Sign in",
  "还没有连接数据库。部署时设置 Supabase 的地址和公开密钥（SUPABASE_URL、SUPABASE_ANON_KEY）后重新构建即可。": "No database is connected yet. Set the Supabase URL and public key (SUPABASE_URL, SUPABASE_ANON_KEY) when deploying, then build again.",
  "侧边栏": "Sidebar",
  "工具": "Tools",
  "更多": "More",
  "全部折叠": "Collapse all",
  "全部展开": "Expand all",
  "{files} 个文件 · {folders} 个文件夹": "{files} files · {folders} folders",
  "属性": "Properties",
  "左右分屏": "Split left and right",
  "上下分屏": "Split top and bottom",
  "大纲": "Outline",
  "编辑": "Edit",
  "完成": "Done",
  "网页": "Web",
  "在博客上打开这篇文章": "Open this post on the blog",
  "下载": "Download",
  "关闭这个窗格": "Close this pane",
  "从左边打开一个文件，或新建一条笔记": "Open a file from the left, or write a new note",
  "新建的笔记放在「随手记」里，第一行是标题，输入后自动保存。把左边的文件拖到窗格的上下左右边缘，就能分屏打开。": "New notes go in Quick notes. The first line is the title, and everything saves as you type. Drag a file from the left onto any edge of a pane to open it side by side.",
  "笔记内容": "Note text",
  "第一行是标题…": "The first line is the title…",
  "有新版本 · 点此刷新": "New version · click to reload",
  // settings
  "关闭": "Close",
  "外观": "Appearance",
  "风格": "Style",
  "玻璃": "Glass",
  "通透的毛玻璃": "Frosted, see-through panels",
  "纸张": "Paper",
  "暖色纸面，衬线字": "Warm paper, serif text",
  "终端": "Terminal",
  "黑底绿字，等宽": "Green on black, monospace",
  "方块": "Blocks",
  "像素方块世界": "A pixel-art block world",
  "明暗": "Light / dark",
  "每种风格都有浅色和深色": "Every style has a light and a dark version",
  "浅色": "Light",
  "深色": "Dark",
  "正文字号": "Text size",
  "文档预览和编辑时的文字大小": "Size of document and editor text",
  "小": "Small",
  "标准": "Normal",
  "大": "Large",
  "语言": "Language",
  "界面文字的语言，切换后会刷新页面": "Language of the interface; the page reloads when it changes",
  "跟随系统": "System",
  "阅读": "Reading",
  "新打开的文档显示大纲": "Show the outline in newly opened documents",
  "只对宽窗格有效，窄窗格和手机上点 ☰ 打开": "Wide panes only; in narrow panes and on phones, tap ☰",
  "布局": "Layout",
  "侧边栏和大纲宽度": "Sidebar and outline width",
  "恢复默认": "Reset",
  "同步": "Sync",
  "立即同步": "Sync now",
  "本机缓存": "Local cache",
  "计算中…": "Calculating…",
  "清除": "Clear",
  "账号": "Account",
  "在其他设备上登录同一个账号即可同步": "Sign in with this account on other devices to sync",
  "退出登录": "Sign out",
  "关于": "About",
  "检查更新": "Check for updates",
  // sync and files
  "本机存储已满，最新改动可能只在内存里，请保持联网让它同步。": "This device's storage is full. The latest changes may only be in memory, so stay online to let them sync.",
  "离线 · 已存在本机": "Offline · saved on this device",
  "同步中…": "Syncing…",
  "已同步": "Synced",
  "同步失败": "Sync failed",
  "没能同步到云端，改动已保存在本机，联网后会自动重试。": "Couldn't sync to the cloud. Your changes are saved on this device and will retry once online.",
  "未命名": "Untitled",
  "{names} 超过 50 MB，没有上传。": "{names}: over 50 MB, not uploaded.",
  "上传中 · 剩 {n} 个": "Uploading · {n} left",
  "「{name}」上传失败：{msg}。": "Couldn't upload “{name}”: {msg}.",
  "网络问题": "network problem",
  "加载中": "Loading",
  "这段 Mermaid 图表有语法错误，下面显示原文：": "This Mermaid diagram has a syntax error. Its source is shown below:",
  "[图片：{name}]": "[image: {name}]",
  "没有找到这篇笔记": "Note not found",
  "文件": "file",
  "读取失败": "Couldn't read it",
  "离线，这个文件还没缓存过": "Offline, and this file isn't cached yet",
  "无标题": "Untitled",
  "今天 {time}": "Today {time}",
  "未同步": "Not synced",
  "修改于 {time}": "Edited {time}",
  "<strong>没有找到</strong>换个关键词试试。": "<strong>Nothing found</strong>Try another word.",
  "<strong>这里还是空的</strong>点「新建」写一条笔记，或者点「上传」放文件进来。Mac 上运行同步程序后，选中的文件夹会自动出现在这里。": "<strong>Nothing here yet</strong>Click New to write a note, or Upload to add files. Run the sync agent on a Mac and the folders you pick appear here.",
  "随手记": "Quick notes",
  "关闭大纲": "Close the outline",
  "待保存…": "Unsaved…",
  "读取文件失败，请检查网络。": "Couldn't read the file. Check your connection.",
  "保存中…": "Saving…",
  "保存失败": "Save failed",
  "「{name}」没保存上，请联网后再改一下或点「完成」重试。": "“{name}” wasn't saved. Once online, edit it again or click Done to retry.",
  "关系图谱 · {nodes} 个节点 · {edges} 条链接": "Graph · {nodes} nodes · {edges} links",
  "隐藏标签": "Hide tags",
  "显示标签": "Show tags",
  "居中": "Center",
  "还没有 Markdown 文件或笔记。": "No Markdown files or notes yet.",
  "载入中…": "Loading…",
  "{name} · 编辑中，自动保存": "{name} · editing, saves automatically",
  // settings, dynamic
  "{n} 个文档已存在本机": "{n} documents stored on this device",
  " · 共用 {size}": " · {size} in all",
  "，离线也能打开": ", readable offline",
  "侧边栏 {side} · 大纲 {toc}，拖动边缘调整，双击恢复": "Sidebar {side} · outline {toc}. Drag an edge to resize, double-click to reset",
  "{notes} 条随手记 · {files} 个文件": "{notes} quick notes · {files} files",
  "版本 {v}": "Version {v}",
  "未知": "unknown",
  "已清除，文档会在打开时重新下载": "Cleared. Documents download again when opened",
  "检查中…": "Checking…",
  "没能连上网站，稍后再试": "Couldn't reach the site. Try again later",
  "版本 {v} · 已是最新": "Version {v} · up to date",
  // sign-in
  "请填写邮箱，密码至少 6 位。": "Enter your email, and a password of at least 6 characters.",
  "正在注册…": "Signing up…",
  "正在登录…": "Signing in…",
  "邮箱或密码不对。": "Wrong email or password.",
  "这个邮箱还没确认，请先点邮件里的确认链接。": "This email isn't confirmed yet. Click the link in the confirmation email first.",
  "这个邮箱已经注册过了，直接登录吧。": "This email is already registered. Sign in instead.",
  "出错了：{msg}": "Something went wrong: {msg}",
  "确认邮件已发到 {email}，点里面的链接后回来登录。": "A confirmation email went to {email}. Click its link, then come back to sign in.",
};

export function t(zh, vars) {
  const s = lang === "en" ? EN[zh] ?? zh : zh;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}

// Fixed text and the placeholder / aria-label / title attributes of index.html, templates included.
export function translatePage() {
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  if (lang !== "en") return;
  const ATTRS = ["placeholder", "aria-label", "title"];
  const walk = (root) => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) {
      const k = n.nodeValue.trim();
      if (k && EN[k]) n.nodeValue = n.nodeValue.replace(k, EN[k]);
    }
    for (const el of root.querySelectorAll("*")) {
      for (const a of ATTRS) { const v = el.getAttribute(a); if (v && EN[v]) el.setAttribute(a, EN[v]); }
      if (el.tagName === "TEMPLATE") walk(el.content);
    }
  };
  walk(document.body);
  document.title = EN["随记"];
}
