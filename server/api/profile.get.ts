export default defineEventHandler((event) => ({
  name: 'Native profile',
  ready: true,
  serverPlugin: Boolean(event.context && event.context.nativePlugin)
}))
