/*
Copyright 2022 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

/* eslint-disable @typescript-eslint/no-explicit-any */
import { RemoteHostApis, RemoteMethodInvoker, HostMethodAddress } from "./types.js";

/**
 * Build a fake object that turns "method calls" into RPC messages
 * The resulting object will recursively make more fake proxies on demand until
 * one of the looked-up properties is invoked as a function.
 * Then it will call the passed `invoke` method with a {@link HostMethodAddress}
 * that can send the method invocation as an RPC message to another realm.
 *
 * @example
 * ```js
 * const invoker = (methodAddress) => console.log(
 *   address.path,
 *   address.name,
 *   address.args
 * );
 * const ns = makeNamespaceProxy(invoker);
 *
 * // looking up any property on the object will work
 *
 * ns.example.builds.method.call.message("foo", 1);
 *
 * // Console will log:
 * ['example','builds','method','call']
 * 'message'
 * ["foo", 1]
 *```
 * @internal
 *
 * @param invoke - Callback that receives address
 */
// export function makeNamespaceProxy<ProxiedApi extends object>(
//   invoke: RemoteMethodInvoker<unknown>,
//   path: string[] = []
// ): RemoteHostApis<ProxiedApi> {
//   console.log('THIS IS GLOBAL PATH', path)
//   const handler: ProxyHandler<Record<string, any>> = {
//     get: (target, prop) => {
//       console.log(prop, typeof prop);
//       if (typeof prop === "string") {
//         if (!Reflect.has(target, prop)) {
//           const next = makeNamespaceProxy(invoke, path.concat(prop));
//           Reflect.set(target, prop, next);
//         }
//         return Reflect.get(target, prop) as unknown;
//       } else {
//         throw new Error(
//           `Cannot look up a symbol ${String(prop)} on a host connection proxy.`
//         );
//       }
//     },
//   };
//   const target = {} as unknown as RemoteHostApis<ProxiedApi>;
//   // Only trap the apply if there's at least two levels of namespace.
//   // uix.host() is not a function, and neither is uix.host.bareMethod().
//   if (path.length < 2) {
//     return new Proxy<RemoteHostApis<ProxiedApi>>(target, handler);
//   }
//   const invoker = (...args: unknown[]) => {
//     console.log('INVOKER PARAMS', {
//       path: path.slice(0, -1),
//       name: path[path.length - 1],
//       args,
//     })
//     return invoke({
//       path: path.slice(0, -1),
//       name: path[path.length - 1],
//       args,
//     }) };
//   return new Proxy<typeof invoker>(invoker, {
//     ...handler,
//     apply(target, _, args: unknown[]) {
//       console.log('APPLY', target, args)
//       return target(...args);
//       //const result: any = await target(...args)
//       // console.log('APPLY RESULT', result, typeof result['closest'])
//       //return makeProxy(invoker, {});
//     },
//   }) as unknown as typeof target;
// }
class AddressBuilder {
  currentPath: string[] = [];
  addressCache: HostMethodAddress[] = [];

  addPath(chunk: string) {
    this.currentPath.push(chunk);
  }

  addMethod(...args: unknown[]) {
    this.addressCache.push({
      path: this.currentPath.slice(0, -1),
      name: this.currentPath[this.currentPath.length - 1],
      args: args
    });
    this.currentPath = [];
  }
  compileFlush(): HostMethodAddress[] {
    const result = this.addressCache;
    this.addressCache = [];
    this.currentPath = [];
    return result;
  }
}

export function makeProxy<ProxiedApi extends object>(
    invoke: RemoteMethodInvoker<unknown>,
    addressBuilder: AddressBuilder = new AddressBuilder()
): RemoteHostApis<ProxiedApi> {

  // const invoker = (...args: unknown[]) => {
  //   return invoke({
  //     path: ['test'],
  //     args: [],
  //     name: "getTest"
  //   })
  // };
  return new Proxy(() => {}, {
      get: function(target, property): any {
        console.log('PROP', property)
        if (typeof property === "string") {
          if (property === 'then') {
            const result = invoke(addressBuilder.compileFlush())
            Reflect.set(target, property, result);
            return result;
          } else if (!Reflect.has(target, property)) {
            addressBuilder.addPath(property);
            const next = makeProxy(invoke, addressBuilder);
            Reflect.set(target, property, next);
          }
          return Reflect.get(target, property) as unknown;
        } else {
          throw new Error(
            `Cannot look up a symbol ${String(property)} on a host connection proxy.`
          );
        }
      },
      apply: function(target, method, argumentsList): any {
        console.log('METHOD CALL + ARGUMENTS', argumentsList)
        addressBuilder.addMethod(argumentsList)
        return makeProxy(invoke, addressBuilder);
      }
  }) as unknown as RemoteHostApis<ProxiedApi>;
}
