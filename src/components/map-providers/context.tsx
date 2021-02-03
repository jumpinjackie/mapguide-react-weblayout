import * as React from "react";
import { GenericMapProviderContext } from './generic';
import type { IMapProviderContext } from './base';
import { Provider, useDispatch, useSelector } from "react-redux";
import type { IApplicationState } from "../../api/common";

const MapProviderContext = React.createContext<IMapProviderContext>(new GenericMapProviderContext());

/**
 * Wraps the provider component of react-redux
 * @since 0.14
 */
export const ReduxProvider: React.FC<{ store: ReduxStoreImpl }> = ({ store, children }) => <Provider store={store}>{children}</Provider>

/**
 * Wraps useDispatch from react-redux
 * @since 0.14
 */
export function useReduxDispatch() {
    return useDispatch();
}

/**
 * Fetches the requested sub-section of the application state
 * @since 0.14
 */
export function useAppState<TState>(selector: (state: IApplicationState) => TState, equalityFn?: (left: TState, right: TState) => boolean) {
    return useSelector<IApplicationState, TState>(selector, equalityFn);
}

/**
 * @since 0.14
 */
export const MapProviderContextProvider: React.FC<{ value: IMapProviderContext }> = ({ value, children }) => {
    return <MapProviderContext.Provider value={value}>
        {children}
    </MapProviderContext.Provider>
}

/**
 * @since 0.14
 */
export function useMapProviderContext() {
    return React.useContext(MapProviderContext);
}

/**
 * @since 0.14
 */
export type ReduxStoreImpl = any;

/**
 * @since 0.14
 */
export const MapContextProvider: React.FC<{ value: IMapProviderContext, store?: ReduxStoreImpl }> = ({ value, store, children }) => {
    let inner = children;
    if (store) {
        inner = <ReduxProvider store={store}>
            {children}
        </ReduxProvider>;
    }
    return <MapProviderContextProvider value={value}>
        {inner}
    </MapProviderContextProvider>
};