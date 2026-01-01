// Basic worker sample for workerd
// This sample uses standard Web APIs and does NOT require native bun:* support
// For Bun API support, use the bun-bundle sample instead

const startTime = Date.now()

export default {
  async fetch(request) {
    const url = new URL(request.url)
    
    switch (url.pathname) {
      case '/':
        return new Response(JSON.stringify({
          message: 'Hello from workerd.',
          runtime: 'workerd',
          uptime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/hash':
        const data = url.searchParams.get('data') || 'hello'
        const encoder = new TextEncoder()
        const dataBuffer = encoder.encode(data)
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
        
        return new Response(JSON.stringify({
          input: data,
          algorithm: 'SHA-256',
          hash: hashHex
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/uuid':
        return new Response(JSON.stringify({
          uuid: crypto.randomUUID()
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/echo':
        const body = await request.text()
        return new Response(JSON.stringify({
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers),
          body: body || null
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/stream':
        const stream = new ReadableStream({
          start(controller) {
            const chunks = ['Hello', ' ', 'from', ' ', 'streaming', '.']
            let i = 0
            
            const intervalId = setInterval(() => {
              if (i < chunks.length) {
                controller.enqueue(new TextEncoder().encode(chunks[i]))
                i++
              } else {
                clearInterval(intervalId)
                controller.close()
              }
            }, 100)
          }
        })
        
        return new Response(stream, {
          headers: { 'content-type': 'text/plain' }
        })
      
      case '/health':
        return new Response('OK', {
          status: 200,
          headers: { 'content-type': 'text/plain' }
        })
      
      default:
        return new Response(JSON.stringify({
          error: 'Not Found',
          path: url.pathname,
          availableRoutes: ['/', '/hash', '/uuid', '/echo', '/stream', '/health']
        }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
    }
  }
}
