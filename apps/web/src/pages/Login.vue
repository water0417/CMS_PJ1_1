<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, auth } from '../api';
import { refreshSurveys } from '../workspace';
import ArchiveTitle from '../components/ArchiveTitle.vue';
const register = ref(false),
  username = ref(''),
  password = ref(''),
  busy = ref(false);
const route = useRoute(),
  router = useRouter();
async function submit() {
  if (busy.value) return;
  if (!username.value.trim() || !password.value) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  busy.value = true;
  try {
    if (register.value)
      await api('/auth/register', 'POST', {
        username: username.value.trim(),
        password: password.value,
      });
    auth.user = await api('/auth/login', 'POST', {
      username: username.value.trim(),
      password: password.value,
    });
    await refreshSurveys();
    const next = String(route.query.next ?? '/');
    await router.push(
      next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/',
    );
    ElMessage.success(register.value ? '账号创建成功' : '欢迎回来');
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="login-spread">
    <section class="login-editorial">
      <div class="hero-kicker">
        <span class="volume">ASKWELL / 01</span>
        A SPACE FOR QUESTIONS
      </div>
      <ArchiveTitle />
      <h1>
        让好奇发生。
        <br />
        让答案抵达。
      </h1>
      <p>
        从一个想法，到一份清晰的问卷。
        <br />
        用灵活的题型与逻辑，收集真实的声音。
      </p>
      <div class="login-editorial-index">
        <span>01 / DESIGN</span>
        <span>02 / COLLECT</span>
        <span>03 / DISCOVER</span>
      </div>
    </section>
    <section class="login-form-panel">
      <div class="account-index">ACCOUNT / {{ register ? 'CREATE' : 'WELCOME BACK' }}</div>
      <h2>{{ register ? '开启你的探索。' : '欢迎回来。' }}</h2>
      <p class="muted">
        {{ register ? '创建账号，写下你的第一份问卷。' : '登录后，继续你的问卷工作。' }}
      </p>
      <form @submit.prevent="submit">
        <label>
          用户名
          <el-input
            v-model="username"
            autocomplete="username"
            placeholder="3～24 位中文、字母或数字"
            maxlength="24"
            :disabled="busy"
          />
        </label>
        <label>
          密码
          <el-input
            v-model="password"
            type="password"
            show-password
            :autocomplete="register ? 'new-password' : 'current-password'"
            placeholder="至少 8 位"
            maxlength="128"
            :disabled="busy"
          />
        </label>
        <el-button native-type="submit" type="primary" :loading="busy" class="full">
          {{ register ? '创建账号并登录' : '登录工作空间' }} ↗
        </el-button>
      </form>
      <p class="login-switch">
        {{ register ? '已有账号？' : '还没有账号？' }}
        <button class="text-button" :disabled="busy" @click="register = !register">
          {{ register ? '直接登录' : '立即注册' }}
        </button>
      </p>
    </section>
  </div>
</template>
