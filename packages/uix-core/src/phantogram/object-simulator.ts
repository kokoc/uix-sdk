import { unwrap, wrap } from "./message-wrapper";
import type { DataEmitter } from "./emitters";
import type { DefMessage, Materialized, Simulated } from "./object-walker";
import {
  simulateFuncsRecursive,
  materializeFuncsRecursive,
} from "./object-walker";
import { makeCallSender, receiveCalls } from "./rpc";
import type { Simulator } from "./remote-subject";
import { RemoteSubject } from "./remote-subject";
import type { DefTicket } from "./tickets";

const bindAll = <T>(inst: T, methods: (keyof T)[]) => {
  for (const methodName of methods) {
    const method = inst[methodName];
    if (typeof method === "function") {
      inst[methodName] = method.bind(inst);
    }
  }
};

interface CleanupNotifier {
  register(obj: any, heldValue: string, ref?: any): void;
  unregister(ref: any): void;
}

interface CleanupNotifierConstructor {
  new (cb: (handle: unknown) => void): CleanupNotifier;
}

export class ObjectSimulator implements Simulator {
  private fnCounter = 0;
  private senderCache: WeakMap<DefTicket, CallableFunction> = new WeakMap();
  private receiverTicketCache: WeakMap<CallableFunction, DefTicket> =
    new WeakMap();
  private cleanupNotifier: CleanupNotifier;
  subject: RemoteSubject;
  makeReceiver(fn: CallableFunction, parent?: Object) {
    let fnTicket = this.receiverTicketCache.get(fn);
    if (!fnTicket) {
      fnTicket = {
        fnId: `${fn.name || "<anonymous>"}_${++this.fnCounter}`,
      };
      // Bind function to parent object if it exists
      let boundFunction = fn;
      if (parent) {
        boundFunction = fn.bind(parent);
      }
      const cleanup = receiveCalls(boundFunction, fnTicket, new WeakRef(this.subject));
      this.subject.onOutOfScope(fnTicket, cleanup);
      this.receiverTicketCache.set(boundFunction, fnTicket);
    }
    return wrap(fnTicket);
  }
  makeSender(message: DefMessage, _?: Object) {
    const ticket = unwrap(message);
    /* istanbul ignore else: preopt */
    if (!this.senderCache.has(ticket)) {
      const sender = makeCallSender(ticket, new WeakRef(this.subject));
      this.cleanupNotifier.register(sender, ticket.fnId, sender);
      this.senderCache.set(ticket, sender);
      return sender;
    } else {
      return this.senderCache.get(ticket) as CallableFunction;
    }
  }
  simulate<T>(localObject: T) {
    const obj = simulateFuncsRecursive<T>(this.makeReceiver, localObject);
    return obj;
  }
  materialize<T>(simulated: T) {
    return materializeFuncsRecursive<T>(this.makeSender, simulated);
  }
  constructor(subject: RemoteSubject, cleanupNotifier: CleanupNotifier) {
    this.cleanupNotifier = cleanupNotifier;
    this.subject = subject;

    bindAll(this, ["makeSender", "makeReceiver", "simulate", "materialize"]);
  }
  static create(
    dataEmitter: DataEmitter,
    Cleanup: CleanupNotifierConstructor
  ): ObjectSimulator {
    let simulator: Simulator;
    // proxy simulator, so as not to have cyclic dependency
    const simulatorInterface: Simulator = {
      simulate: (x) => simulator.simulate(x),
      materialize: (x) => simulator.materialize(x),
    };

    const subject = new RemoteSubject(dataEmitter, simulatorInterface);

    const cleanupNotifier = new Cleanup((fnId: string) => {
      return subject.notifyCleanup({ fnId });
    });

    simulator = new ObjectSimulator(subject, cleanupNotifier);

    return simulator as ObjectSimulator;
  }
}
