// ==UserScript==
// @name         ajaxHooker
// @author       cxxjackie
// @version      1.2.3
// @supportURL   https://bbs.tampermonkey.net.cn/thread-3284-1-1.html
// ==/UserScript==

var ajaxHooker = function() {
    const win = window.unsafeWindow || document.defaultView || window;
    const hookFns = [];
    const realXhr = win.XMLHttpRequest;
    const xhrProto = realXhr.prototype;
    const xhrProtoDesc = Object.getOwnPropertyDescriptors(xhrProto);
    const xhrReadyState = xhrProtoDesc.readyState.get;
    const resProto = win.Response.prototype;
    const toString = Object.prototype.toString;
    let realXhrOpen = xhrProto.open;
    let realXhrSend = xhrProto.send;
    const realFetch = win.fetch;
    const xhrResponses = ['response', 'responseText', 'responseXML'];
    const fetchResponses = ['arrayBuffer', 'blob', 'formData', 'json', 'text'];
    const xhrAsyncEvents = ['readystatechange', 'load', 'loadend'];
    let filter;
    function emptyFn() {}
    function errorFn(err) {
        console.error(err);
    }
    function defineProp(obj, prop, getter, setter) {
        Object.defineProperty(obj, prop, {
            configurable: true,
            enumerable: true,
            get: getter,
            set: setter
        });
    }
    function readonly(obj, prop, value = obj[prop]) {
        defineProp(obj, prop, () => value, emptyFn);
    }
    function writable(obj, prop, value = obj[prop]) {
        Object.defineProperty(obj, prop, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: value
        });
    }
    function toFilterObj(obj) {
        return {
            type: obj.type,
            url: obj.url,
            method: obj.method && obj.method.toUpperCase()
        };
    }
    function shouldFilter(type, url, method) {
        return filter && !filter.find(obj => 
            (!obj.type || obj.type === type)
            && (!obj.url || (toString.call(obj.url) === '[object String]' ? url.includes(obj.url) : obj.url.test(url)))
            && (!obj.method || obj.method === method.toUpperCase())
        );
    }
    function waitForHookFns(request) {
        return Promise.all(hookFns.map(fn => Promise.resolve(fn(request)).then(emptyFn, errorFn)));
    }
    function waitForRequestKeys(request, requestClone) {
        return Promise.all(['url', 'method', 'abort', 'headers', 'data'].map(key => {
            return Promise.resolve(request[key]).then(val => request[key] = val, () => request[key] = requestClone[key]);
        }));
    }
    function fakeEventSIP() {
        this.ajaxHooker_stopped = true;
    }
    function xhrDelegateEvent(e) {
        const xhr = e.target;
        e.stopImmediatePropagation = fakeEventSIP;
        xhr.__ajaxHooker.hookedEvents[e.type].forEach(fn => !e.ajaxHooker_stopped && fn.call(xhr, e));
        const onEvent = xhr.__ajaxHooker.hookedEvents['on' + e.type];
        typeof onEvent === 'function' && onEvent.call(xhr, e);
    }
    function xhrReadyStateChange(e) {
        if (xhrReadyState.call(e.target) === 4) {
            e.target.dispatchEvent(new CustomEvent('ajaxHooker_responseReady', {detail: e}));
        } else {
            e.target.__ajaxHooker.delegateEvent(e);
        }
    }
    function xhrLoadAndLoadend(e) {
        e.target.__ajaxHooker.delegateEvent(e);
    }
    function fakeXhr() {
        const xhr = new realXhr();
        realXhrSend = xhr.send;
        xhr.send = fakeXhrSend;
        if (!('__ajaxHooker' in xhr)) {
            realXhrOpen = xhr.open;
            xhr.open = fakeXhrOpen;
            try {
                const ah = xhr.__ajaxHooker = {
                    headers: {},
                    hookedEvents: {
                        readystatechange: new Set(),
                        load: new Set(),
                        loadend: new Set()
                    },
                    delegateEvent: xhrDelegateEvent
                };
                xhr.setRequestHeader = (header, value) => {
                    xhrProto.setRequestHeader.call(xhr, header, value);
                    if (xhrReadyState.call(xhr) === 1) {
                        if (ah.headers[header]) {
                            ah.headers[header] += ', ' + value;
                        } else {
                            ah.headers[header] = value;
                        }
                    }
                }
                const realAddEvent = xhr.addEventListener;
                xhr.addEventListener = function(...args) {
                    if (xhrAsyncEvents.includes(args[0])) {
                        ah.hookedEvents[args[0]].add(args[1]);
                    } else {
                        realAddEvent.apply(xhr, args);
                    }
                };
                const realRemoveEvent = xhr.removeEventListener;
                xhr.removeEventListener = function(...args) {
                    if (xhrAsyncEvents.includes(args[0])) {
                        ah.hookedEvents[args[0]].delete(args[1]);
                    } else {
                        realRemoveEvent.apply(xhr, args);
                    }
                };
                xhrAsyncEvents.forEach(evt => {
                    const onEvt = 'on' + evt;
                    defineProp(xhr, onEvt, () => {
                        return ah.hookedEvents[onEvt] || null;
                    }, val => {
                        ah.hookedEvents[onEvt] = typeof val === 'function' ? val : null;
                    });
                });
                realAddEvent.call(xhr, 'readystatechange', xhrReadyStateChange);
                realAddEvent.call(xhr, 'load', xhrLoadAndLoadend);
                realAddEvent.call(xhr, 'loadend', xhrLoadAndLoadend);
            } catch (err) {
                console.error(err);
            }
        }
        return xhr;
    }
    function fakeXhrOpen(method, url, ...args) {
        const xhr = this;
        xhr.__ajaxHooker.url = url;
        xhr.__ajaxHooker.method = method.toUpperCase();
        xhr.__ajaxHooker.openArgs = args;
        xhr.__ajaxHooker.headers = {};
        return realXhrOpen.call(xhr, method, url, ...args);
    }
    function fakeXhrSend(data) {
        const xhr = this;
        const ah = xhr.__ajaxHooker;
        if (xhrReadyState.call(xhr) === 1 && ah) {
            ah.delegateEvent = xhrDelegateEvent;
            xhrResponses.forEach(prop => {
                delete xhr[prop]; // delete descriptor
            });
            if (shouldFilter('xhr', ah.url, ah.method)) {
                xhr.addEventListener('ajaxHooker_responseReady', e => {
                    ah.delegateEvent(e.detail);
                });
                return realXhrSend.call(xhr, data);
            }
            try {
                const request = {
                    type: 'xhr',
                    url: ah.url,
                    method: ah.method,
                    abort: false,
                    headers: ah.headers,
                    data: data,
                    response: null
                };
                const requestClone = {...request};
                waitForHookFns(request).then(() => {
                    waitForRequestKeys(request, requestClone).then(() => {
                        if (request.abort) return;
                        realXhrOpen.call(xhr, request.method, request.url, ...ah.openArgs);
                        for (const header in request.headers) {
                            xhrProto.setRequestHeader.call(xhr, header, request.headers[header]);
                        }
                        data = request.data;
                        xhr.addEventListener('ajaxHooker_responseReady', e => {
                            try {
                                if (typeof request.response === 'function') {
                                    const arg = {
                                        finalUrl: xhr.responseURL,
                                        status: xhr.status,
                                        responseHeaders: {}
                                    };
                                    for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
                                        const parts = line.split(/:\s*/);
                                        if (parts.length === 2) {
                                            const lheader = parts[0].toLowerCase();
                                            if (arg.responseHeaders[lheader]) {
                                                arg.responseHeaders[lheader] += ', ' + parts[1];
                                            } else {
                                                arg.responseHeaders[lheader] = parts[1];
                                            }
                                        }
                                    }
                                    xhrResponses.forEach(prop => {
                                        defineProp(arg, prop, () => {
                                            return arg[prop] = xhrProtoDesc[prop].get.call(xhr);
                                        }, val => {
                                            delete arg[prop];
                                            arg[prop] = val;
                                        });
                                        defineProp(xhr, prop, () => {
                                            const val = xhrProtoDesc[prop].get.call(xhr);
                                            xhr.dispatchEvent(new CustomEvent('ajaxHooker_readResponse', {
                                                detail: {prop, val}
                                            }));
                                            return val;
                                        });
                                    });
                                    xhr.addEventListener('ajaxHooker_readResponse', e => {
                                        arg[e.detail.prop] = e.detail.val;
                                    });
                                    const resPromise = Promise.resolve(request.response(arg)).then(() => {
                                        const task = [];
                                        xhrResponses.forEach(prop => {
                                            const descriptor = Object.getOwnPropertyDescriptor(arg, prop);
                                            if (descriptor && 'value' in descriptor) {
                                                task.push(Promise.resolve(descriptor.value).then(val => {
                                                    arg[prop] = val;
                                                    defineProp(xhr, prop, () => {
                                                        xhr.dispatchEvent(new CustomEvent('ajaxHooker_readResponse', {
                                                            detail: {prop, val}
                                                        }));
                                                        return val;
                                                    });
                                                }, emptyFn));
                                            }
                                        });
                                        return Promise.all(task);
                                    }, errorFn);
                                    const eventsClone = {};
                                    xhrAsyncEvents.forEach(type => {
                                        eventsClone[type] = new Set([...ah.hookedEvents[type]]);
                                        eventsClone['on' + type] = ah.hookedEvents['on' + type];
                                    });
                                    ah.delegateEvent = event => resPromise.then(() => {
                                        event.stopImmediatePropagation = fakeEventSIP;
                                        eventsClone[event.type].forEach(fn => !event.ajaxHooker_stopped && fn.call(xhr, event));
                                        const onEvent = eventsClone['on' + event.type];
                                        typeof onEvent === 'function' && onEvent.call(xhr, event);
                                    });
                                }
                            } catch (err) {
                                console.error(err);
                            }
                            ah.delegateEvent(e.detail);
                        });
                        realXhrSend.call(xhr, data);
                    });
                });
            } catch (err) {
                console.error(err);
                realXhrSend.call(xhr, data);
            }
        } else {
            realXhrSend.call(xhr, data);
        }
    }
    function hookFetchResponse(response, arg, callback) {
        fetchResponses.forEach(prop => {
            response[prop] = () => new Promise((resolve, reject) => {
                resProto[prop].call(response).then(res => {
                    if (prop in arg) {
                        resolve(arg[prop]);
                    } else {
                        try{
                            arg[prop] = res;
                            Promise.resolve(callback(arg)).then(() => {
                                if (prop in arg) {
                                    Promise.resolve(arg[prop]).then(val => resolve(arg[prop] = val), () => resolve(res));
                                } else {
                                    resolve(res);
                                }
                            }, errorFn);
                        } catch (err) {
                            console.error(err);
                            resolve(res);
                        }
                    }
                }, reject);
            });
        });
    }
    function fakeFetch(url, init) {
        if (toString.call(url) === '[object String]') {
            init = init || {};
            init.method = init.method || 'GET';
            init.headers = init.headers || {};
            if (shouldFilter('fetch', url, init.method)) return realFetch.call(win, url, init);
            const request = {
                type: 'fetch',
                url: url,
                method: init.method.toUpperCase(),
                abort: false,
                headers: {},
                data: init.body,
                response: null
            };
            if (toString.call(init.headers) === '[object Headers]') {
                for (const [key, val] of init.headers) {
                    request.headers[key] = val;
                }
            } else {
                request.headers = {...init.headers};
            }
            const requestClone = {...request};
            return new Promise((resolve, reject) => {
                try {
                    waitForHookFns(request).then(() => {
                        waitForRequestKeys(request, requestClone).then(() => {
                            if (request.abort) return reject('aborted');
                            url = request.url;
                            init.method = request.method;
                            init.headers = request.headers;
                            init.body = request.data;
                            realFetch.call(win, url, init).then(response => {
                                if (typeof request.response === 'function') {
                                    const arg = {
                                        finalUrl: response.url,
                                        status: response.status,
                                        responseHeaders: {}
                                    };
                                    for (const [key, val] of response.headers) {
                                        arg.responseHeaders[key] = val;
                                    }
                                    hookFetchResponse(response, arg, request.response);
                                    response.clone = () => {
                                        const resClone = resProto.clone.call(response);
                                        hookFetchResponse(resClone, arg, request.response);
                                        return resClone;
                                    };
                                }
                                resolve(response);
                            }, reject);
                        });
                    });
                } catch (err) {
                    console.error(err);
                    return realFetch.call(win, url, init);
                }
            });
        } else {
            return realFetch.call(win, url, init);
        }
    }
    win.XMLHttpRequest = fakeXhr;
    Object.keys(realXhr).forEach(key => fakeXhr[key] = realXhr[key]);
    fakeXhr.prototype = xhrProto;
    win.fetch = fakeFetch;
    return {
        hook: fn => hookFns.push(fn),
        filter: arr => {
            filter = Array.isArray(arr) && arr.map(toFilterObj)
        },
        protect: () => {
            readonly(win, 'XMLHttpRequest', fakeXhr);
            readonly(win, 'fetch', fakeFetch);
        },
        unhook: () => {
            writable(win, 'XMLHttpRequest', realXhr);
            writable(win, 'fetch', realFetch);
        }
    };
}();
