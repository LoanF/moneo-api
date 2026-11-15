import { EventEmitter } from 'node:events';

export type ChangeModel =
    | 'user'
    | 'account'
    | 'category'
    | 'paymentMethod'
    | 'chequebook'
    | 'transaction'
    | 'recurringPayment'
    | 'budget'
    | 'notification';

export type ChangeEvent = {
    model: ChangeModel;
    type: 'created' | 'updated' | 'deleted' | 'bulk';
    id?: string;
    /** Session à l'origine du changement : le client émetteur peut ignorer son propre écho. */
    origin?: string;
};

const bus = new EventEmitter();
bus.setMaxListeners(0);

export const publish = (userId: string, event: ChangeEvent): void => {
    bus.emit(userId, event);
};

export const subscribe = (userId: string, listener: (event: ChangeEvent) => void): (() => void) => {
    bus.on(userId, listener);
    return () => bus.off(userId, listener);
};
