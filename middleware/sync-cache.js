import Subprovider from 'web3-provider-engine/subproviders/subprovider'

/*
 * Workaround for Ether Shrimp Farmer bug - Web3Provider doesn't implement
 * synchronous send, so we implement it for a handful or methods.
 *
 * We also implement aggressive caching of these
 */
export default class SyncCacheSubprovider extends Subprovider {
  constructor(opts = {}) {
    super(opts)
    this.cache = opts.cache || {}
    this.prefix = opts.prefix || '__SpaceSuit_sync_data_cache_'
  }
  handleRequest(payload, next, end) {
    let method = payload.method
    if (method in handlers) {
      let {cachableValues} = handlers[method]
      if (this.prefix + method in this.cache) {
        end(null, JSON.parse(this.cache[this.prefix + method]))
      } else {
        next((err, res, cb) => {
          if (!err) {
            let cachable = cachableValues(res)
            for (let methodName in cachable) {
              let value = cachable[methodName]
              if (value != null) this.cache[this.prefix + methodName] = JSON.stringify(value)
            }
          }
          cb()
        })
      }
    } else {
      next()
    }
  }

  patchSend(provider) {
    let oldSend = provider.send
    provider.send = (payload) => {
      let method = payload.method
      if (method in handlers) {
        let {defaultValue, cachableValues} = handlers[method]
        if (this.prefix + method in this.cache) {
          return response(payload, JSON.parse(this.cache[this.prefix + method]))
        } else {
          provider.sendAsync(payload, () => {}) // Call purely for side effect of caching
          return response(payload, defaultValue())
        }
      } else if (method === 'eth_uninstallFilter') {
        provider.sendAsync(payload, () => {})
        return reponse(payload, true)
      } else {
        oldSend.call(provider, payload)
      }
    }
  }

  pollForChanges(coinbaseSubprovider, interval = 90000) {
    setInterval(() => {
      coinbaseSubprovider.handleRequest(request('eth_coinbase'), null, (err, res) => {
        if (res && res !== this.cache[this.prefix + 'eth_coinbase']) {
          delete this.cache[this.prefix + 'eth_coinbase']
          delete this.cache[this.prefix + 'eth_accounts']
          this.emitPayload(request('eth_accounts'), () => {})
        }
      })
      // Invalidate cached net version, and request again
      delete this.cache[this.prefix + 'net_version']
      this.emitPayload(request('net_version'), () => {})
    }, interval)
  }
}

function response({id, jsonrpc}, result) {
  return {id, jsonrpc, result}
}

function request(method) {
  return {
    method, params: Array.prototype.slice.call(arguments, 1),
    id: Math.random() * 1000000000000, jsonrpc: '2.0'
  }
}

const handlers = {
  eth_accounts: {
    defaultValue() { return [] },
    cachableValues(result) {
      if (result.length) {
        return {
          eth_accounts: result,
          eth_coinbase: result[0]
        }
      } else {
        return {}
      }
    }
  },
  eth_coinbase: {
    defaultValue() { return null },
    cachableValues(result) {
      return {
        eth_coinbase: result
      }
    }
  },
  net_version: {
    defaultValue() { return null },
    cachableValues(result) {
      return {
        net_version: result
      }
    }
  }
}
