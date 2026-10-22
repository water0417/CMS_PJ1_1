import { createRouter, createWebHistory } from 'vue-router';
import Dashboard from './pages/Dashboard.vue';
import Editor from './pages/Editor.vue';
import Fill from './pages/Fill.vue';
import Stats from './pages/Stats.vue';
import Login from './pages/Login.vue';
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/login', component: Login },
    { path: '/editor/:id', component: Editor },
    { path: '/survey/:publicId', component: Fill },
    { path: '/statistics/:id', component: Stats },
  ],
});
