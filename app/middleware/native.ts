export default defineNuxtRouteMiddleware((to, from) => {
  if (to.path === '/settings' && from.path === '/') return
})
