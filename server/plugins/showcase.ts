export default defineNitroPlugin({
  hooks: {
    request(event) {
      event.context.nativePlugin = true
    }
  }
})
