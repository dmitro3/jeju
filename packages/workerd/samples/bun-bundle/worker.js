// Bun-compatible worker using the bundled compatibility layer
// This works with stock workerd without needing native bun:* support

import Bun from './bun-bundle.js'

const startTime = Date.now()

export default {
  async fetch(request) {
    const url = new URL(request.url)
    
    switch (url.pathname) {
      case '/':
        return new Response(JSON.stringify({
          message: 'Hello from Bun-compatible worker.',
          runtime: 'workerd',
          bunVersion: Bun.version,
          uptime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/bun-version':
        return new Response(JSON.stringify({
          version: Bun.version,
          revision: Bun.revision
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/hash':
        const data = url.searchParams.get('data') || 'hello'
        const hash = Bun.hash(data)
        
        return new Response(JSON.stringify({
          input: data,
          hash: hash.toString(16)
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/deep-equals':
        const obj1 = { a: 1, b: { c: [1, 2, 3] } }
        const obj2 = { a: 1, b: { c: [1, 2, 3] } }
        const obj3 = { a: 1, b: { c: [1, 2, 4] } }
        
        return new Response(JSON.stringify({
          obj1_equals_obj2: Bun.deepEquals(obj1, obj2),
          obj1_equals_obj3: Bun.deepEquals(obj1, obj3)
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/escape-html':
        const html = url.searchParams.get('html') || '<script>alert("xss")</script>'
        
        return new Response(JSON.stringify({
          input: html,
          escaped: Bun.escapeHTML(html)
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/nanoseconds':
        const ns = Bun.nanoseconds()
        
        return new Response(JSON.stringify({
          nanoseconds: ns.toString()
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/file-ops':
        await Bun.write('/test.txt', 'Hello from Bun file API.')
        const file = Bun.file('/test.txt')
        const content = await file.text()
        const exists = await file.exists()
        
        return new Response(JSON.stringify({
          written: true,
          content,
          exists,
          size: file.size
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/inspect':
        const complexObj = {
          name: 'test',
          nested: { deep: { value: [1, 2, 3] } },
          date: new Date()
        }
        
        return new Response(JSON.stringify({
          inspected: Bun.inspect(complexObj)
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/string-width':
        const testStrings = [
          'hello',           // 5
          '你好',            // 4 (CJK characters are double-width)
          'hello世界',       // 9
          '🎉',             // 2 (emoji)
        ]
        
        return new Response(JSON.stringify({
          results: testStrings.map(s => ({
            string: s,
            width: Bun.stringWidth(s)
          }))
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/array-buffer-sink':
        const sink = new Bun.ArrayBufferSink()
        sink.write('Hello ')
        sink.write('World')
        const buffer = sink.end()
        const text = new TextDecoder().decode(buffer)
        
        return new Response(JSON.stringify({
          text,
          byteLength: buffer.byteLength
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/stream-utils':
        const testStream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('Stream '))
            controller.enqueue(new TextEncoder().encode('content'))
            controller.close()
          }
        })
        
        const streamText = await Bun.readableStreamToText(testStream)
        
        return new Response(JSON.stringify({
          streamText
        }), {
          headers: { 'content-type': 'application/json' }
        })
      
      case '/sleep':
        const ms = parseInt(url.searchParams.get('ms') || '100')
        const before = Date.now()
        await Bun.sleep(ms)
        const after = Date.now()
        
        return new Response(JSON.stringify({
          requestedMs: ms,
          actualMs: after - before
        }), {
          headers: { 'content-type': 'application/json' }
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
          availableRoutes: [
            '/',
            '/bun-version',
            '/hash',
            '/deep-equals',
            '/escape-html',
            '/nanoseconds',
            '/file-ops',
            '/inspect',
            '/string-width',
            '/array-buffer-sink',
            '/stream-utils',
            '/sleep',
            '/health'
          ]
        }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
    }
  }
}
