
import { Client } from '../../api/client';
import { SessionKeepAlive } from '../session-keep-alive';
import { Bounds, GenericEvent, ActiveMapTool, ImageFormat, RefreshMode, SelectionVariant, ClientKind, LayerTransparencySet, Size, BLANK_SIZE, IMapGuideViewerSupport } from '../../api/common';
import { IQueryMapFeaturesOptions } from '../../api/request-builder';
import { QueryMapFeaturesResponse, FeatureSet } from '../../api/contracts/query';

import WKTFormat from "ol/format/WKT";

import Polygon, { fromExtent } from 'ol/geom/Polygon';

import Geometry from 'ol/geom/Geometry';
import { queryMapFeatures, setMouseCoordinates, setFeatureTooltipsEnabled } from '../../actions/map';
import View from 'ol/View';
import debounce = require('lodash.debounce');
import { layerTransparencyChanged, areViewsCloseToEqual } from '../../utils/viewer-state';
import { areArraysDifferent } from '../../utils/array';
import { MgLayerSetGroup } from "../../api/mg-layer-set-group";
import { FeatureQueryTooltip } from '../tooltips/feature';
import { RuntimeMap } from '../../api/contracts/runtime-map';
import { debug, warn } from '../../utils/logger';
import { getSiteVersion, canUseQueryMapFeaturesV4 } from '../../utils/site-version';
import { BLANK_GIF_DATA_URI } from '../../constants';
import { isSessionExpiredError } from '../../api/error';
import { BaseMapProviderContext, IMapProviderState, IViewerComponent, IMapProviderStateExtras } from './base';
import { assertIsDefined } from '../../utils/assert';
import { STR_EMPTY } from '../../utils/string';
import { ensureParameters } from '../../utils/url';
import { ActionType } from '../../constants/actions';
import { buildSelectionXml, getActiveSelectedFeatureXml } from '../../api/builders/deArrayify';
import { MapGuideMockMode } from '../mapguide-debug-context';
import { useViewerImageFormat, useConfiguredAgentUri, useConfiguredAgentKind, useViewerPointSelectionBuffer, useViewerFeatureTooltipsEnabled, useConfiguredManualFeatureTooltips, useViewerSelectionColor, useViewerSelectionImageFormat, useViewerActiveFeatureSelectionColor, useActiveMapSelectionSet, useConfiguredLoadIndicatorPositioning, useConfiguredLoadIndicatorColor, useViewerActiveTool, useActiveMapView, useViewerViewRotation, useViewerViewRotationEnabled, useActiveMapName, useViewerLocale, useActiveMapExternalBaseLayers, useConfiguredCancelDigitizationKey, useConfiguredUndoLastPointKey, useActiveMapLayers, useActiveMapInitialExternalLayers } from '../../containers/hooks';
import { useActiveMapState, useActiveMapSessionId, useActiveMapSelectableLayerNames, useActiveMapLayerTransparency, useActiveMapShowGroups, useActiveMapHideGroups, useActiveMapShowLayers, useActiveMapHideLayers, useActiveMapActiveSelectedFeature } from '../../containers/hooks-mapguide';
import { useReduxDispatch } from './context';

export function isMapGuideProviderState(arg: any): arg is IMapGuideProviderState {
    return typeof (arg.agentUri) == 'string'
        && typeof (arg.agentKind) == 'string';
}

function useMapGuideViewerState() {
    const activeTool = useViewerActiveTool();
    const view = useActiveMapView();
    const viewRotation = useViewerViewRotation();
    const viewRotationEnabled = useViewerViewRotationEnabled();
    const mapName = useActiveMapName();
    const locale = useViewerLocale();
    const externalBaseLayers = useActiveMapExternalBaseLayers();
    const cancelDigitizationKey = useConfiguredCancelDigitizationKey();
    const undoLastPointKey = useConfiguredUndoLastPointKey();
    const layers = useActiveMapLayers();
    const initialExternalLayers = useActiveMapInitialExternalLayers();
    const dispatch = useReduxDispatch();
    // ============== MapGuide-specific ================== //
    const imageFormat = useViewerImageFormat();
    const agentUri = useConfiguredAgentUri();
    const agentKind = useConfiguredAgentKind();
    const map = useActiveMapState();
    const pointSelectionBuffer = useViewerPointSelectionBuffer();
    const featureTooltipsEnabled = useViewerFeatureTooltipsEnabled();
    const manualFeatureTooltips = useConfiguredManualFeatureTooltips();
    const sessionId = useActiveMapSessionId();
    const selectionColor = useViewerSelectionColor();
    const selectionImageFormat = useViewerSelectionImageFormat();
    const selectableLayerNames = useActiveMapSelectableLayerNames();
    const layerTransparency = useActiveMapLayerTransparency();
    const showGroups = useActiveMapShowGroups();
    const hideGroups = useActiveMapHideGroups();
    const showLayers = useActiveMapShowLayers();
    const hideLayers = useActiveMapHideLayers();
    const activeSelectedFeature = useActiveMapActiveSelectedFeature();
    const activeSelectedFeatureColor = useViewerActiveFeatureSelectionColor();
    const selection = useActiveMapSelectionSet();

    let bgColor: string | undefined;
    if (map) {
        bgColor = `#${map.BackgroundColor.substring(2)}`;
    }
    let activeSelectedFeatureXml;
    if (activeSelectedFeature && selection && selection.FeatureSet) {
        activeSelectedFeatureXml = getActiveSelectedFeatureXml(selection.FeatureSet, activeSelectedFeature);
    }

    let isReady = false;
    if (agentUri && map && sessionId && layerTransparency) {
        isReady = true;
    }

    const nextState: IMapGuideProviderState & IMapProviderStateExtras = {
        activeTool,
        view,
        viewRotation,
        viewRotationEnabled,
        mapName,
        locale,
        externalBaseLayers,
        cancelDigitizationKey,
        undoLastPointKey,
        initialExternalLayers,
        // ========== IMapProviderStateExtras ========== //
        isReady,
        bgColor,
        layers,
        // =========== MapGuide-specific ============== //
        imageFormat,
        agentUri,
        agentKind,
        map,
        pointSelectionBuffer,
        featureTooltipsEnabled,
        manualFeatureTooltips,
        sessionId,
        selectionColor,
        selectionImageFormat,
        selectableLayerNames,
        layerTransparency,
        showGroups: showGroups ?? [],
        hideGroups: hideGroups ?? [],
        showLayers: showLayers ?? [],
        hideLayers: hideLayers ?? [],
        activeSelectedFeatureXml: activeSelectedFeatureXml ?? STR_EMPTY,
        activeSelectedFeatureColor,
        selection
    };
    return nextState;
}

export interface IMapGuideProviderState extends IMapProviderState {
    imageFormat: ImageFormat;
    agentUri: string | undefined;
    agentKind: ClientKind;
    map: RuntimeMap | undefined;
    pointSelectionBuffer: number;
    manualFeatureTooltips: boolean;
    featureTooltipsEnabled: boolean;
    sessionId: string | undefined;
    selectionColor: string;
    selectionImageFormat: ImageFormat;
    selectableLayerNames: string[];
    layerTransparency: LayerTransparencySet | undefined;
    showGroups: string[];
    hideGroups: string[];
    showLayers: string[];
    hideLayers: string[];
    activeSelectedFeatureXml: string;
    activeSelectedFeatureColor: string;
    selection: QueryMapFeaturesResponse | null;
}

export class MapGuideMapProviderContext extends BaseMapProviderContext<IMapGuideProviderState, MgLayerSetGroup> implements IMapGuideViewerSupport {
    /**
     * This is a throttled version of _refreshOnStateChange(). Call this on any
     * modifications to pendingStateChanges
     *
     * @private
     */
    private refreshOnStateChange: (mapName: string,
        showGroups: string[] | undefined,
        showLayers: string[] | undefined,
        hideGroups: string[] | undefined,
        hideLayers: string[] | undefined) => void;



    // ============= MapGuide-specific private state ============== //
    private _client: Client;
    private _keepAlive: SessionKeepAlive | undefined;
    private _featureTooltip: FeatureQueryTooltip | undefined;
    private _wktFormat: WKTFormat;
    // ============================================================= //

    constructor(public mockMode: MapGuideMockMode | undefined = undefined) {
        super();
        this._wktFormat = new WKTFormat();
        this.refreshOnStateChange = debounce(this._refreshOnStateChange.bind(this), 500);
    }

    /**
     * @override
     */
    public getHookFunction(): () => IMapProviderState & IMapProviderStateExtras {
        return useMapGuideViewerState;
    }

    public setMockMode(mode: MapGuideMockMode | undefined): void {
        this.mockMode = mode;
    }

    /**
     * @override
     */
    public hideAllPopups() {
        super.hideAllPopups();
        this._featureTooltip?.setEnabled(false);
    }

    /**
     *
     * @override
     * @protected
     * @returns {(MapGuideMockMode | undefined)}
     * @memberof MapGuideMapProviderContext
     */
    protected getMockMode(): MapGuideMockMode | undefined { return this.mockMode; }

    protected getInitialProviderState(): Omit<IMapGuideProviderState, keyof IMapProviderState> {
        return {
            imageFormat: "PNG8",
            agentUri: undefined,
            agentKind: "mapagent",
            map: undefined,
            pointSelectionBuffer: 2,
            featureTooltipsEnabled: true,
            manualFeatureTooltips: false,
            sessionId: undefined,
            selectionColor: "0000FF",
            selectionImageFormat: "PNG8",
            selectableLayerNames: [],
            layerTransparency: {},
            showGroups: [],
            hideGroups: [],
            showLayers: [],
            hideLayers: [],
            activeSelectedFeatureXml: STR_EMPTY,
            activeSelectedFeatureColor: "FF0000",
            selection: null
        }
    }

    public getProviderName(): string { return "MapGuide"; }

    /**
     * @override
     * @returns {(IMapGuideViewerSupport | undefined)}
     * @memberof MapGuideMapProviderContext
     */
    mapguideSupport(): IMapGuideViewerSupport | undefined {
        return this;
    }

    //#region IMapGuideViewerSupport
    getSelection(): QueryMapFeaturesResponse | null {
        return this._state.selection;
    }
    getSelectionXml(selection: FeatureSet, layerIds?: string[] | undefined): string {
        return buildSelectionXml(selection, layerIds);
    }
    getSessionId(): string {
        return this._state.sessionId!;
    }
    setFeatureTooltipEnabled(enabled: boolean): void {
        this._comp?.onDispatch(setFeatureTooltipsEnabled(enabled));
    }
    //#endregion

    //#region IMapViewerContextCallback
    private onSessionExpired() {

    }
    protected onProviderMapClick(px: [number, number]): void {
        if (this._state.manualFeatureTooltips && this._state.featureTooltipsEnabled) {
            this.queryFeatureTooltip(px);
        } else if (this._state.activeTool === ActiveMapTool.Select) {
            const ptBuffer = this._state.pointSelectionBuffer ?? 2;
            const box = this.getPointSelectionBox(px, ptBuffer);
            const geom = fromExtent(box);
            const options = this.buildDefaultQueryOptions(geom);
            options.maxfeatures = 1;
            this.sendSelectionQuery(options);
        }
    }
    //#endregion

    //#region Map Context
    /**
     * @override
     * @protected
     * @param {GenericEvent} e
     * @returns
     * @memberof BaseMapProviderContext
     */
    protected onMouseMove(e: GenericEvent) {
        if (this._comp) {
            this.handleMouseTooltipMouseMove(e);
            if (this._comp.isContextMenuOpen()) {
                return;
            }
            if (!this._state.manualFeatureTooltips) {
                this.handleFeatureTooltipMouseMove(e);
            }
            if (this._state.mapName) {
                this._comp.onDispatch?.(setMouseCoordinates(this._state.mapName, e.coordinate));
            }
        }
    }
    private queryFeatureTooltip(pixel: [number, number]) {
        if (this._featureTooltip && this._featureTooltip.isEnabled()) {
            this._featureTooltip.raiseQueryFromPoint(pixel);
        }
    }
    private handleFeatureTooltipMouseMove(e: GenericEvent) {
        if (this._featureTooltip && this._featureTooltip.isEnabled()) {
            this._featureTooltip.onMouseMove(e);
        }
    }
    private enableFeatureTooltips(enabled: boolean): void {
        this._featureTooltip?.setEnabled(enabled);
    }
    private refreshMapInternal(name: string, mode: RefreshMode = RefreshMode.LayersOnly | RefreshMode.SelectionOnly): void {
        const layerSet = this.getLayerSetGroup(name);
        layerSet?.refreshMap(mode);
    }
    private async showSelectedFeature(mapExtent: Bounds, size: Size, map: RuntimeMap, selectionColor: string, featureXml: string | undefined) {
        const sv = getSiteVersion(map);
        // This operation requires v4.0.0 QUERYMAPFEATURES, so bail if this ain't the right version
        if (!canUseQueryMapFeaturesV4(sv)) {
            return;
        }
        const layerSet = this.getLayerSetGroup(map.Name);
        try {
            if (featureXml) {
                const r = await this._client.queryMapFeatures_v4({
                    mapname: map.Name,
                    session: map.SessionId,
                    selectionformat: "PNG",
                    featurefilter: featureXml,
                    selectioncolor: selectionColor,
                    requestdata: 2, //Inline selection
                    layerattributefilter: 0,
                    persist: 0 //IMPORTANT: This is a transient selection
                });
                if (r.InlineSelectionImage) {
                    const dataUri = `data:${r.InlineSelectionImage.MimeType};base64,${r.InlineSelectionImage.Content}`;
                    layerSet?.showActiveSelectedFeature(mapExtent, size, dataUri);
                } else {
                    layerSet?.showActiveSelectedFeature(mapExtent, BLANK_SIZE, BLANK_GIF_DATA_URI);
                }
            } else {
                layerSet?.showActiveSelectedFeature(mapExtent, BLANK_SIZE, BLANK_GIF_DATA_URI);
            }
        } catch (e) {
            layerSet?.showActiveSelectedFeature(mapExtent, BLANK_SIZE, BLANK_GIF_DATA_URI);
        }
    }
    //#endregion

    /**
     * DO NOT CALL DIRECTLY, call this.refreshOnStateChange() instead, which is a throttled version
     * of this method
     * @private
     */
    private _refreshOnStateChange(mapName: string,
        showGroups: string[] | undefined,
        showLayers: string[] | undefined,
        hideGroups: string[] | undefined,
        hideLayers: string[] | undefined) {
        if (showGroups || showLayers || hideGroups || hideLayers) {
            //this.refreshOnStateChange(map, showGroups, showLayers, hideGroups, hideLayers);
            const layerSet = this.getLayerSetGroup(mapName);
            if (layerSet instanceof MgLayerSetGroup) {
                layerSet.setMapGuideMocking(this.getMockMode());
                layerSet.update(showGroups, showLayers, hideGroups, hideLayers);
            }
        }
    }
    /**
     * @override
     * @protected
     * @param {GenericEvent} e
     * @memberof MapGuideMapProviderContext
     */
    protected onImageError(e: GenericEvent) {
        this._keepAlive?.lastTry().catch(err => {
            if (isSessionExpiredError(err)) {
                this.onSessionExpired();
            }
        });
    }


    private getSelectableLayers(): string[] {
        return this._state.selectableLayerNames ?? [];
    }
    private buildDefaultQueryOptions(geom: Geometry | string, reqQueryFeatures: number = 1 /* Attributes */): IQueryMapFeaturesOptions {
        assertIsDefined(this._state.sessionId);
        assertIsDefined(this._state.mapName);
        const names = this.getSelectableLayers();
        let wkt: string;
        if (typeof geom === 'string') {
            wkt = geom;
        } else {
            wkt = this._wktFormat.writeGeometry(geom);
        }
        return {
            mapname: this._state.mapName,
            session: this._state.sessionId,
            geometry: wkt,
            requestdata: reqQueryFeatures,
            layernames: names.length > 0 ? names.join(",") : undefined,
            persist: 1
        };
    }

    /**
     * @virtual
     * @protected
     * @param {Polygon} geom
     * @memberof MapGuideMapProviderContext
     */
    protected selectFeaturesByExtent(geom: Polygon) {
        this.sendSelectionQuery(this.buildDefaultQueryOptions(geom));
    }

    private onOpenTooltipLink = (url: string) => {
        let fixedUrl = url;
        if (this._state.mapName && this._state.sessionId) {
            fixedUrl = ensureParameters(url, this._state.mapName, this._state.sessionId, this._state.locale);
        }
        this._comp?.onDispatch({
            type: ActionType.TASK_INVOKE_URL,
            payload: {
                url: fixedUrl
            }
        });
    };

    /**
     * @override
     * @protected
     */
    protected initLayerSet(nextState: IMapGuideProviderState): MgLayerSetGroup {
        const { mapName } = nextState;
        assertIsDefined(mapName);
        assertIsDefined(this._state.map);
        const layerSet = new MgLayerSetGroup(nextState as any, {
            getImageLoaders: () => super.getImageSourceLoaders(mapName),
            getTileLoaders: () => super.getTileSourceLoaders(mapName),
            getBaseTileLoaders: () => super.getBaseTileSourceLoaders(mapName),
            getMockMode: () => this.getMockMode(),
            incrementBusyWorker: () => this.incrementBusyWorker(),
            decrementBusyWorker: () => this.decrementBusyWorker(),
            addImageLoading: () => this._comp?.addImageLoading(),
            addImageLoaded: () => this._comp?.addImageLoaded(),
            onImageError: (e) => this.onImageError(e),
            onSessionExpired: () => this.onSessionExpired(),
            getSelectableLayers: () => this.getSelectableLayers(),
            getClient: () => this._client,
            isContextMenuOpen: () => this._comp?.isContextMenuOpen() ?? false,
            getAgentUri: () => this._state.agentUri!,
            getAgentKind: () => this._state.agentKind,
            getMapName: () => this._state.mapName!,
            getSessionId: () => this._state.sessionId!,
            getLocale: () => this._state.locale,
            isFeatureTooltipEnabled: () => this.isFeatureTooltipEnabled(),
            getPointSelectionBox: (pt) => this.getPointSelectionBox(pt, this._state.pointSelectionBuffer),
            openTooltipLink: (url) => this.onOpenTooltipLink(url),
            addFeatureToHighlight: (feat, bAppend) => this.addFeatureToHighlight(feat, bAppend)
        });
        this._layerSetGroups[mapName] = layerSet;
        layerSet.update(nextState.showGroups, nextState.showLayers, nextState.hideGroups, nextState.hideLayers);
        return layerSet;
    }

    /**
     * @override
     * @readonly
     * @memberof MapGuideMapProviderContext
     */
    public isMouseOverTooltip() { return this._featureTooltip?.isMouseOver == true || this._selectTooltip?.isMouseOver == true; }

    /**
     * @override
     */
    public detachFromComponent(): void {
        this._keepAlive?.dispose();
        this._keepAlive = undefined;
        this._featureTooltip?.dispose();
        this._featureTooltip = undefined;
        super.detachFromComponent();
    }

    /**
     * @override
     * @param {HTMLElement} el
     * @param {IViewerComponent} comp
     * @memberof MapGuideMapProviderContext
     */
    public attachToComponent(el: HTMLElement, comp: IViewerComponent): void {
        super.attachToComponent(el, comp);
        this._keepAlive = new SessionKeepAlive(() => this._state.sessionId!, this._client, this.onSessionExpired.bind(this));
        this._featureTooltip = new FeatureQueryTooltip(this._map!, {
            incrementBusyWorker: () => this.incrementBusyWorker(),
            decrementBusyWorker: () => this.decrementBusyWorker(),
            onSessionExpired: () => this.onSessionExpired(),
            getAgentUri: () => this._state.agentUri!,
            getAgentKind: () => this._state.agentKind,
            getMapName: () => this._state.mapName!,
            getSessionId: () => this._state.sessionId!,
            getLocale: () => this._state.locale,
            getPointSelectionBox: (pt) => this.getPointSelectionBox(pt, this._state.pointSelectionBuffer),
            openTooltipLink: (url) => this.onOpenTooltipLink(url)
        });
        this._featureTooltip.setEnabled(this._state.featureTooltipsEnabled);
    }
    /**
     * @override
     * @param {RefreshMode} [mode=RefreshMode.LayersOnly | RefreshMode.SelectionOnly]
     * @memberof MapGuideMapProviderContext
     */
    public refreshMap(mode: RefreshMode = RefreshMode.LayersOnly | RefreshMode.SelectionOnly): void {
        assertIsDefined(this._state.mapName);
        this.refreshMapInternal(this._state.mapName, mode);
    }

    /**
     * @override
     * @protected
     * @param {MgLayerSetGroup} layerSetGroup
     * @memberof MapGuideMapProviderContext
     */
    protected onBeforeAttachingLayerSetGroup(layerSetGroup: MgLayerSetGroup): void {
        layerSetGroup.setMapGuideMocking(this.getMockMode());
    }

    /**
     *
     * @virtual
     * @param {IMapGuideProviderState} nextState
     * @memberof MapGuideMapProviderContext
     */
    public setProviderState(nextState: IMapGuideProviderState): void {
        // If viewer not mounted yet, just accept the next state and bail
        if (!this._comp || !this._map) {
            if (nextState.agentUri) {
                this._client = new Client(nextState.agentUri, nextState.agentKind);
            }
            this._state = nextState;
            return;
        }
        //
        // React (no pun intended) to prop changes
        //
        if (nextState.imageFormat != this._state.imageFormat) {
            warn(`Unsupported change of props: imageFormat`);
        }
        if (nextState.agentUri && nextState.agentUri != this._state.agentUri) {
            warn(`Unsupported change of props: agentUri`);
            this._client = new Client(nextState.agentUri, nextState.agentKind);
        }
        if (nextState.agentUri && nextState.agentKind != this._state.agentKind) {
            warn(`Unsupported change of props: agentKind`);
            this._client = new Client(nextState.agentUri, nextState.agentKind);
        }
        let bChangedView = false;
        //map
        if (nextState.mapName != this._state.mapName && this._map && this._ovMap) {
            this.hideAllPopups();
            const oldLayerSet = this.getLayerSetGroup(this._state.mapName);
            const newLayerSet = this.ensureAndGetLayerSetGroup(nextState);
            oldLayerSet?.detach(this._map, this._ovMap);
            newLayerSet.setMapGuideMocking(this.getMockMode());
            newLayerSet.attach(this._map, this._ovMap);
            //This would happen if we switch to a map we haven't visited yet
            if (!nextState.view) {
                newLayerSet.fitViewToExtent();
                bChangedView = true;
            } else {
                const layerSet = this.getLayerSetGroup(nextState.mapName);
                if (layerSet) {
                    this.applyView(layerSet, nextState.view);
                }
            }
        }
        //selectionColor
        if (nextState.selectionColor && nextState.selectionColor != this._state.selectionColor) {
            const layerSet = this.getLayerSetGroup(nextState.mapName);
            layerSet?.updateSelectionColor(nextState.selectionColor);
        }
        //featureTooltipsEnabled
        if (nextState.featureTooltipsEnabled != this._state.featureTooltipsEnabled) {
            this.enableFeatureTooltips(nextState.featureTooltipsEnabled);
        }
        //externalBaseLayers
        if (nextState.externalBaseLayers != null &&
            nextState.externalBaseLayers.length > 0) {
            const layerSet = this.getLayerSetGroup(nextState.mapName);
            layerSet?.updateExternalBaseLayers(nextState.externalBaseLayers);
        }
        //Layer transparency
        if (nextState.layerTransparency && layerTransparencyChanged(nextState.layerTransparency, this._state.layerTransparency)) {
            const layerSet = this.getLayerSetGroup(nextState.mapName);
            layerSet?.updateTransparency(nextState.layerTransparency);
        }
        //Layer/Group visibility
        if (nextState.mapName && (areArraysDifferent(nextState.showGroups, this._state.showGroups) ||
            areArraysDifferent(nextState.hideGroups, this._state.hideGroups) ||
            areArraysDifferent(nextState.showLayers, this._state.showLayers) ||
            areArraysDifferent(nextState.hideLayers, this._state.hideLayers))) {
            this.refreshOnStateChange(nextState.mapName, nextState.showGroups, nextState.showLayers, nextState.hideGroups, nextState.hideLayers);
        }
        //view
        if (!areViewsCloseToEqual(nextState.view, this._state.view)) {
            const vw = nextState.view;
            if (vw != null && !bChangedView) {
                const layerSet = this.ensureAndGetLayerSetGroup(nextState);
                this.applyView(layerSet, vw);
            } else {
                debug(`Skipping zoomToView as next/current views are close enough or target view is null`);
            }
        }
        //overviewMapElement
        if (nextState.overviewMapElementSelector) {
            this.updateOverviewMapElement(nextState.overviewMapElementSelector);
        }
        //viewRotation
        if (this._state.viewRotation != nextState.viewRotation) {
            this.getOLView().setRotation(nextState.viewRotation);
        }
        //viewRotationEnabled
        if (this._state.viewRotationEnabled != nextState.viewRotationEnabled) {
            if (this._map) {
                const view = this.getOLView();
                const newView = new View({
                    enableRotation: nextState.viewRotationEnabled,
                    rotation: nextState.viewRotation,
                    center: view.getCenter(),
                    resolution: view.getResolution(),
                    resolutions: view.getResolutions(),
                    minResolution: view.getMinResolution(),
                    maxResolution: view.getMaxResolution(),
                    maxZoom: view.getMaxZoom(),
                    minZoom: view.getMinZoom(),
                    //constrainRotation: view.constrainRotation(),
                    projection: view.getProjection(),
                    zoom: view.getZoom()
                });
                this._map.setView(newView);
            }
        }
        //activeSelectedFeatureXml
        if (this._state.activeSelectedFeatureXml != nextState.activeSelectedFeatureXml) {
            if (this._map && nextState.map) {
                const ms = this._map.getSize();
                if (ms) {
                    const view = this.getOLView();
                    const me: any = view.calculateExtent(ms);
                    const size = { w: ms[0], h: ms[1] };
                    this.showSelectedFeature(me, size, nextState.map, nextState.activeSelectedFeatureColor, nextState.activeSelectedFeatureXml);
                }
            }
        }

        this._state = nextState;
    }

    public setSelectionXml(xml: string, queryOpts?: Partial<IQueryMapFeaturesOptions>, success?: (res: QueryMapFeaturesResponse) => void, failure?: (err: Error) => void): void {
        if (!this._state.mapName || !this._comp || !this._state.sessionId || !this._state.selectionColor) {
            return;
        }
        //NOTE: A quirk of QUERYMAPFEATURES is that when passing in selection XML (instead of geometry),
        //you must set the layerattributefilter to the full bit mask otherwise certain features in the
        //selection XML will not be rendered because they may not pass the layer attribute filter
        const reqQueryFeatures = 1; //Attributes
        this.incrementBusyWorker();
        const mapName = this._state.mapName;
        const qOrig = {
            mapname: mapName,
            session: this._state.sessionId,
            persist: 1,
            featurefilter: xml,
            selectioncolor: this._state.selectionColor,
            selectionformat: this._state.selectionImageFormat ?? "PNG8",
            maxfeatures: -1,
            requestdata: reqQueryFeatures
        };
        const queryOptions = { ...qOrig, ...queryOpts };
        const action = queryMapFeatures(mapName, {
            options: queryOptions,
            callback: res => {
                this.decrementBusyWorker();
                if (success) {
                    success(res);
                }
            },
            errBack: err => {
                this.decrementBusyWorker();
                if (failure) {
                    failure(err);
                }
            }
        });
        this._comp.onDispatch(action);
    }

    public clearSelection(): void {
        this.setSelectionXml("");
    }

    public selectByGeometry(geom: Geometry, selectionMethod?: SelectionVariant): void {
        const options = this.buildDefaultQueryOptions(geom);
        if (selectionMethod) {
            options.selectionvariant = selectionMethod;
        }
        this.sendSelectionQuery(options);
    }
    public queryMapFeatures(options: IQueryMapFeaturesOptions, success?: (res: QueryMapFeaturesResponse) => void, failure?: (err: Error) => void): void {
        this.sendSelectionQuery(options, success, failure);
    }
    public isFeatureTooltipEnabled(): boolean {
        return this._featureTooltip?.isEnabled() == true;
    }

    // ================= MapGuide-specific =================== //



    private sendSelectionQuery(queryOpts?: IQueryMapFeaturesOptions, success?: (res: QueryMapFeaturesResponse) => void, failure?: (err: Error) => void) {
        if (!this._state.mapName || !this._comp || !this._state.sessionId || !this._state.selectionColor || (queryOpts != null && (queryOpts.layernames ?? []).length == 0)) {
            return;
        }
        this.incrementBusyWorker();
        const mapName = this._state.mapName;
        const qOrig: Partial<IQueryMapFeaturesOptions> = {
            mapname: mapName,
            session: this._state.sessionId,
            persist: 1,
            selectionvariant: "INTERSECTS",
            selectioncolor: this._state.selectionColor,
            selectionformat: this._state.selectionImageFormat ?? "PNG8",
            maxfeatures: -1
        };
        const queryOptions: IQueryMapFeaturesOptions = { ...qOrig, ...queryOpts } as IQueryMapFeaturesOptions;
        const action = queryMapFeatures(mapName, {
            options: queryOptions,
            callback: res => {
                this.decrementBusyWorker();
                if (success) {
                    success(res);
                }
            },
            errBack: err => {
                this.decrementBusyWorker();
                if (failure) {
                    failure(err);
                }
            }
        });
        this._comp.onDispatch(action);
    }
}