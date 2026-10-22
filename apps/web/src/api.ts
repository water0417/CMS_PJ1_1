import { reactive } from 'vue';
export const auth = reactive<{ user: { id: string; username: string } | null; loaded: boolean }>({
  user: null,
  loaded: false,
});
export async function api(url: string, method = 'GET', body?: any): Promise<any> {
  const res = await fetch('/api' + url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && url !== '/auth/login' && url !== '/auth/me') {
      auth.user = null;
      const next = location.pathname + location.search;
      location.assign('/login?next=' + encodeURIComponent(next));
    }
    throw Object.assign(new Error(data.message ?? '请求失败'), {
      code: data.code,
      status: res.status,
    });
  }
  return data;
}
export const labels: Record<string, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  text: '文本填空',
  number: '数字填空',
  matrix: '矩阵单选',
  ranking: '排序题',
  time: '时间题',
  slider: '滑动评分',
  color: '色彩题',
};
export const typeMarks: Record<string, string> = {
  single_choice: '◉',
  multiple_choice: '☑',
  text: 'T',
  number: '#',
  matrix: '▦',
  ranking: '↕',
  time: '◷',
  slider: '↔',
  color: '◈',
};
export async function loadAuth() {
  try {
    auth.user = await api('/auth/me');
  } catch {
    auth.user = null;
  }
  auth.loaded = true;
}
export const uid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 16);
