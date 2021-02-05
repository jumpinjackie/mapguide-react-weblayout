import * as React from "react";
import { getWidth, getHeight } from "ol/extent";
import olPoint from "ol/geom/Point";
import olLineString from "ol/geom/LineString";
import olPolygon from "ol/geom/Polygon";
import olCircle from "ol/geom/Circle";
import olGeom from "ol/geom/Geometry";
import { Client } from "../api/client";
import { MgError } from "../api/error";
import { RuntimeMap } from "../api/contracts/runtime-map";
import { FeatureSet, SelectedFeatureSet, QueryMapFeaturesResponse } from "../api/contracts/query";
import { RefreshMode, ICommand, ClientKind, UnitOfMeasure, Bounds } from "../api/common";
import { deArrayify, buildSelectionXml } from "../api/builders/deArrayify";
import { FormFrameShim } from "../components/form-frame-shim";
import { getCommand, DefaultCommands } from "../api/registry/command";
import { tr } from "../api/i18n";
import { serialize } from "../api/builders/mapagent";
import { ILocalizedMessages } from "../strings/msgdef";
import { getUnitOfMeasure } from '../utils/units';
import { useActiveMapSelectionSet, useConfiguredAgentUri, useConfiguredAgentKind, useViewerBusyCount, useViewerSizeUnits } from './hooks';
import { getFusionRoot, getViewer } from '../api/runtime';
import { debug, error, warn } from '../utils/logger';
import { QueryMapFeatureActionOptions, queryMapFeatures, setSelection, invokeCommand } from '../actions/map';
import { refresh } from '../actions/legend';
import { goHome } from '../actions/taskpane';
import { FUSION_MAP_NAME, FUSION_TASKPANE_NAME, FUSION_REDLINE_NAME  } from '../constants';
import { useActiveMapState } from './hooks-mapguide';
import { useReduxDispatch } from "../components/map-providers/context";

function isEmptySelection(selection: QueryMapFeaturesResponse | undefined): boolean {
    if (selection && selection.FeatureSet) {
        let count = 0;
        for (const l of selection.FeatureSet.Layer) {
            count += l.Class.ID.length;
        }
        return count === 0;
    }
    return true; //Treat undefined/null as empty
}

/**
 * This class emulates a subset of the Fusion API. This represents the top-level object named "Fusion"
 */
class FusionApiShim {
    public Event: FusionEventApiShim;
    constructor(private parent: ViewerApiShimInner) {
        this.Event = new FusionEventApiShim();
    }
    xml2json(callback: Function, response: any, json: boolean) {
        if (json) {
            const o = JSON.parse(response.responseText);
            callback(o);
        } else {
            const options = {
                onSuccess: callback,
                method: 'POST',
                parameters: { 'xml': encodeURIComponent(response.responseText) }
            };
            this.ajaxRequest('common/php/Xml2JSON.php', options);
        }
    }
    ajaxRequest(url: string, options: any) { // onSuccess: Function, onFailure: Function, parameters: any) {
        let reqUrl = `${getFusionRoot()}/${url}`;
        const client = this.parent.getClient();
        const resolve = options.onSuccess || (() => debug(`No success handler defined for this operation`));
        const fail = options.onFailure || options.onException || ((_r: any, res: Error) => error(res));
        if (client) {
            if (typeof (options.parameters) == 'string') {
                reqUrl += "?" + options.parameters;
                fetch(reqUrl, {
                    method: "GET"
                }).then(res => {
                    if (!res.ok) {
                        const stat = res.statusText;
                        res.text().then(t => {
                            fail({
                                transport: {
                                    responseText: t
                                }
                            }, new MgError(stat));
                        });
                    } else {
                        res.text().then(t => resolve({
                            responseText: t
                        }));
                    }
                });
            } else {
                fetch(reqUrl, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                    } as any,
                    method: "POST",
                    body: serialize(options.parameters, false) //form
                }).then(res => {
                    if (!res.ok) {
                        const stat = res.statusText;
                        res.text().then(t => {
                            fail({
                                transport: {
                                    responseText: t
                                }
                            }, new MgError(stat));
                        });
                    } else {
                        res.text().then(t => resolve({
                            responseText: t
                        }));
                    }
                });
            }
        }
    }

    getMapByName(name: string): FusionWidgetApiShim | undefined {
        if (this.parent.props.map && this.parent.props.map.Name == name) {
            return new FusionWidgetApiShim(this.parent);
        }
        return undefined;
    }
    getWidgetById(id: string): FusionWidgetApiShim | undefined {
        if (id == FUSION_TASKPANE_NAME ||
            id == FUSION_MAP_NAME) {
            return new FusionWidgetApiShim(this.parent);
        }
        return undefined;
    }
    getWidgetsByType(type: string): FusionWidgetApiShim[] {
        if (type == FUSION_REDLINE_NAME) {
            return [
                new FusionWidgetApiShim(this.parent)
            ];
        }
        return [];
    }
    registerForEvent(eventID: number, callback: (...args: any[]) => void): void {
        this.parent.registerForEvent(eventID, callback);
    }
}

/**
 * This class emulates the OpenLayers.Function.bind helper
 */
class OL2FunctionHelper {
    public bind(func: Function, obj_this: any) {
        return func.bind(obj_this);
    }
}

/**
 * This class emulates a subset of the OpenLayers 2 API
 */
class OL2Shim {
    public Function: OL2FunctionHelper;
    constructor() {
        this.Function = new OL2FunctionHelper();
    }
    i18n(key: keyof ILocalizedMessages): string {
        return tr(key);
    }
}

/**
 * This class emulates event constants defined by Fusion
 */
class FusionEventApiShim {
    constructor() {

    }
    public get MAP_SELECTION_ON(): number { return 1; }
    public get MAP_SELECTION_OFF(): number { return 2; }
    public get MAP_ACTIVE_LAYER_CHANGED(): number { return 3; }
    public get MAP_BUSY_CHANGED(): number { return 4; }
}

type FusionGeomDigitizer = (geom: any) => void;

/**
 * This class emulates a digitized rectangle
 */
class OL2Rect {
    constructor(private poly: olPolygon) { }
    getVertices(): ({ x: number, y: number } | undefined)[] {
        const coords = this.poly.getExtent();
        return [
            { x: coords[0], y: coords[1] },//0
            undefined,                     //1
            { x: coords[2], y: coords[3] } //2
        ]
    }
}

/**
 * This class emulates an OpenLayers 2 geometry
 */
class OL2Geom {
    constructor(private geom: olGeom) { }
    get x(): number {
        const g = this.geom;
        if (g instanceof olPoint) {
            return g.getCoordinates()[0];
        }
        return NaN;
    }
    get y(): number {
        const g = this.geom;
        if (g instanceof olPoint) {
            return g.getCoordinates()[1];
        }
        return NaN;
    }
    getVertices(): { x: number, y: number }[] {
        const g = this.geom;
        if (g instanceof olPoint) {
        } else if (g instanceof olLineString) {
            return g.getCoordinates().map(c => {
                return { x: c[0], y: c[1] };
            })
        } else if (g instanceof olPolygon) {
            return g.getLinearRing(0).getCoordinates().map(c => {
                return { x: c[0], y: c[1] };
            });
        }
        return [];
    }
    get CLASS_NAME(): string {
        if (this.geom instanceof olPoint) {
            return "OpenLayers.Geometry.Point";
        } else if (this.geom instanceof olLineString) {
            return "OpenLayers.Geometry.LineString";
        } else if (this.geom instanceof olPolygon) {
            return "OpenLayers.Geometry.Polygon";
        } else {
            return "Unknown";
        }
    }
}

/**
 * This class emulates OpenLayers.Bounds
 */
class OL2Bounds {
    public left: number;
    public bottom: number;
    public right: number;
    public top: number;
    constructor(bounds: [number, number, number, number] | { left: number, bottom: number, right: number, top: number }) {
        if (Array.isArray(bounds)) {
            this.left = bounds[0];
            this.bottom = bounds[1];
            this.right = bounds[2];
            this.top = bounds[3];
        } else {
            this.left = bounds.left;
            this.bottom = bounds.bottom;
            this.right = bounds.right;
            this.top = bounds.top;
        }
    }
}

let mRedlineMessageEnabled: boolean | undefined;

/**
 * @hidden
 */
function isRedlineMessagePromptEnabled(): boolean {
    return !!mRedlineMessageEnabled;
}

/**
 * @hidden
 */
export function enableRedlineMessagePrompt(enabled: boolean): void {
    mRedlineMessageEnabled = enabled;
}

/**
 * This class emulates APIs from various widgets
 */
class FusionWidgetApiShim {
    private _activeLayer: any;
    private _activeToast: string | undefined;

    constructor(private parent: ViewerApiShimInner) {
    }

    goHome(): void { //TaskPane
        this.parent.goHome();
    }
    processFeatureInfo(r: any): void {
        const o = JSON.parse(r.responseText);
        if (o.FeatureInformation) {
            const norm: QueryMapFeaturesResponse = deArrayify(o);
            const selXml = buildSelectionXml(norm.FeatureSet);
            this.setSelection(selXml, false);
        } else if (o.Message) {
            this.warn(o.Message);
        }
    }
    getSelectableLayers(): FusionSelectedLayer[] { //Map
        const layers = [] as FusionSelectedLayer[];
        const { map } = this.parent.props;
        if (map && map.Layer) {
            const matches = map.Layer
                .filter(l => l.Selectable)
                .map(l => {
                    return { layerName: l.Name, legendLabel: l.LegendLabel };
                });
            for (const l of matches) {
                layers.push(l);
            }
        }
        return layers;
    }
    get mapWidget(): FusionWidgetApiShim { //Map
        return this;
    }
    getExtentFromPoint(x: number, y: number, scale: number): OL2Bounds | undefined { //Map
        const viewer = getViewer();
        if (viewer) {
            const view = viewer.getCurrentView();
            if (!scale) {
                scale = view.scale;
            }
            const res = viewer.scaleToResolution(scale);
            const size = viewer.getSize();
            const w = size[0] * res;
            const h = size[1] * res;
            return new OL2Bounds([
                x - w / 2,
                y - h / 2,
                x + w / 2,
                y + h / 2
            ]);
        }
        return undefined;
    }
    setExtents(bounds: OL2Bounds) { //Map
        const viewer = getViewer();
        if (viewer) {
            viewer.zoomToExtent([bounds.left, bounds.bottom, bounds.right, bounds.top]);
        }
    }
    setActiveLayer(layer: any) { //Map
        this._activeLayer = layer;
        const fusionAPI: FusionApiShim = this.parent.getFusionAPI();
        this.parent.triggerFusionEvent(fusionAPI.Event.MAP_ACTIVE_LAYER_CHANGED);
    }
    getActiveLayer(): any { //Map
        return this._activeLayer;
    }
    clearSelection(): void { //Map
        this.parent.ClearSelection();
    }
    cancelDigitization(): void { //Map
        const viewer = getViewer();
        if (viewer) {
            viewer.cancelDigitization();
        }
    }
    query(options: any): void { //Map
        const viewer = getViewer()?.mapguideSupport();
        const { map } = this.parent.props;
        if (map && viewer) {
            const mapName = map.Name;
            const qmo = {
                mapname: mapName,
                session: map.SessionId,
                selectionvariant: options.selectionType,
                maxfeatures: options.maxFeatures,
                geometry: options.geometry,
                layernames: options.layers
            };
            if (qmo.maxfeatures == 0) {
                qmo.maxfeatures = -1;
            }

            viewer.setSelectionXml("", qmo);
        }
    }
    setSelection(xml: string, zoomTo: boolean): void { //Map
        const viewer = getViewer();
        const mgSupport = viewer?.mapguideSupport();
        if (viewer && mgSupport) {
            //TODO: Support zoomTo
            mgSupport.setSelectionXml(xml, {
                layerattributefilter: 0 //Need to set this in order for requestdata to be respected
            }, (selection) => {
                if (zoomTo) {
                    const fact = viewer.getOLFactory();
                    let bounds: Bounds | null = null;
                    if (selection != null && selection.SelectedFeatures != null) {
                        selection.SelectedFeatures.SelectedLayer.forEach(layer => {
                            layer.Feature.forEach(feat => {
                                const b: any = feat.Bounds.split(" ").map(s => parseFloat(s));
                                if (bounds == null) {
                                    bounds = b;
                                } else {
                                    bounds = fact.extendExtent(bounds, b);
                                }
                            })
                        });
                    }
                    if (bounds) {
                        const bw = getWidth(bounds);
                        const bh = getHeight(bounds);
                        if (bw > 0 && bh > 0) { //Don't zoom if we get 0 bounds. Cruncing bounds from selected points would do this.
                            const view = viewer.getViewForExtent(bounds);
                            this.parent.ZoomToView(view.x, view.y, view.scale);
                        }
                    }
                }
            });
        }
    }
    getSelectedLayers(): FusionSelectedLayer[] { //Map
        const layers = [] as FusionSelectedLayer[];
        const map = this.parent.props.map;
        const selectionSet = this.parent.props.selectionSet;
        if (map && map.Layer && selectionSet && selectionSet.FeatureSet) {
            for (const fl of selectionSet.FeatureSet.Layer) {
                const ml = map.Layer.filter(l => l.ObjectId == fl["@id"])[0];
                if (ml) {
                    layers.push({ legendLabel: ml.LegendLabel, layerName: ml.Name });
                }
            }
        }
        return layers;
    }
    isBusy(): boolean { //Map
        if (this.parent.props.busyCount)
            return this.parent.props.busyCount > 0;
        return false;
    }
    isMapLoaded(): boolean { //Map
        return true;
    }
    redraw(): void { //Map
        this.parent.Refresh();
    }

    reloadMap(): void { //Map
        this.parent.Refresh();
    }
    info(msg: string): void { //Map MessageBar
        const viewer = getViewer();
        if (viewer) {
            this._activeToast = viewer.toastPrimary("info-sign", <div className="mg-fusion-message" dangerouslySetInnerHTML={{ __html: msg }} />);
        }
    }
    warn(msg: string): void { //Map MessageBar
        const viewer = getViewer();
        if (viewer) {
            this._activeToast = viewer.toastPrimary("warning-sign", <div className="mg-fusion-message" dangerouslySetInnerHTML={{ __html: msg }} />);
        }
    }
    error(msg: string): void { //Map MessageBar
        const viewer = getViewer();
        if (viewer) {
            this._activeToast = viewer.toastPrimary("error", <div className="mg-fusion-message" dangerouslySetInnerHTML={{ __html: msg }} />);
        }
    }
    clear(): void { //Map MessageBar
        const viewer = getViewer();
        if (viewer && this._activeToast) {
            viewer.dismissToast(this._activeToast);
        }
    }
    get mapMessagePrompt(): boolean { //Redline
        return isRedlineMessagePromptEnabled();
    }
    get container(): FusionWidgetApiShim {
        return this;
    }
    get ownerDocument(): Document {
        return document;
    }
    get message(): FusionWidgetApiShim { //Map
        return this;
    }
    get layerRoot(): FusionWidgetApiShim { //Map
        return this;
    }
    findLayerByAttribute(name: string, value: string) { //Map
        const map = this.parent.props.map;
        if (map && map.Layer) {
            const ml = map.Layer.filter(lyr => {
                switch (name) {
                    case "layerName":
                        return lyr.Name == value;
                }
                return false;
            })[0];
            if (ml) {
                return { layerName: ml.Name };
            }
        }
        return null;
    }
    pixToGeoMeasure(tolerance: number) { //Map
        const viewer = getViewer();
        if (viewer) {
            const res = viewer.getResolution();
            if (res) {
                return tolerance * res;
            }
        }
        return 0.000001; //Pull some random number
    }
    drawMap(): void {
        this.parent.Refresh();
    }
    registerForEvent(eventID: number, callback: Function): void { //Widget
        this.parent.registerForEvent(eventID, callback);
    }
    deregisterForEvent(eventID: number, callback: Function): void { //Widget
        this.parent.deregisterForEvent(eventID, callback);
    }
    static toOL2Circle(circ: olCircle) {
        const c = circ.getCenter();
        return {
            x: c[0],
            y: c[1],
            r: circ.getRadius()
        };
    }
    digitizePoint(_options: any, handler: FusionGeomDigitizer) { //Map
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizePoint(pt => {
                handler(new OL2Geom(pt));
            });
        }
    }
    digitizeLine(_options: any, handler: FusionGeomDigitizer) { //Map
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizeLine(ln => {
                handler(new OL2Geom(ln));
            });
        }
    }
    digitizeLineString(_options: any, handler: FusionGeomDigitizer) { //Map
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizeLineString(lstr => {
                handler(new OL2Geom(lstr));
            });
        }
    }
    digitizeRectangle(_options: any, handler: FusionGeomDigitizer) { //Map
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizeRectangle(rect => {
                handler(new OL2Rect(rect));
            });
        }
    }
    digitizePolygon(_options: any, handler: FusionGeomDigitizer) { //Map
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizePolygon(poly => {
                handler(new OL2Geom(poly));
            });
        }
    }
    digitizeCircle(_options: any, handler: FusionGeomDigitizer) { //Map
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizeCircle(circ => {
                handler(FusionWidgetApiShim.toOL2Circle(circ));
            });
        }
    }
}

interface FusionSelectedLayer {
    legendLabel: string;
    layerName: string;
}

export type SelectionHandlerCallback = (mapName: string, selection: QueryMapFeaturesResponse | undefined) => void;

export class AjaxViewerLineStringOrPolygon {
    private coordinates: IAjaxViewerPoint[];
    constructor(coordinates: IAjaxViewerPoint[]) {
        this.coordinates = coordinates;
    }
    public get Count(): number { return this.coordinates.length; }
    public Point(i: number): IAjaxViewerPoint {
        const pt = this.coordinates[i];
        return pt;
    }
}

export interface IAjaxViewerRect {
    Point1: IAjaxViewerPoint;
    Point2: IAjaxViewerPoint;
}

export interface IAjaxViewerCircle {
    Center: IAjaxViewerPoint;
    Radius: number;
}

export interface IAjaxViewerPoint {
    X: number;
    Y: number;
}

export interface IAjaxViewerLayer {
    legend: string;
    name: string;
    objectid: string;
}

export interface IAjaxViewerBounds {
    minx: number;
    miny: number;
    maxx: number;
    maxy: number;
}

export enum AjaxViewerMapActionCode {
    PanMode = 1,
    PanUp = 2,
    PanDown = 3,
    PanRight = 4,
    PanLeft = 5,
    ZoomMode = 6,
    ZoomIn = 7,
    ZoomOut = 8,
    ZoomRect = 9,
    ZoomSelection = 10,
    ZoomExtents = 11,
    PrevView = 12,
    NextView = 13,
    InitialView = 14,
    SelectionMode = 15,
    SelectRadius = 16,
    SelectPolygon = 17,
    ClearSelection = 19,
    RefreshMap = 20,
    CopyMap = 21,
    About = 22
}

export type IAjaxViewerSelectionSet = any;

export interface IViewerApiShimProps {

}

interface IViewerApiShimState {
    map: RuntimeMap | undefined;
    selectionSet: QueryMapFeaturesResponse | null;
    agentUri: string | undefined;
    agentKind: ClientKind;
    busyCount: number;
    sizeUnits: UnitOfMeasure;
}

interface IViewerApiShimDispatch {
    goHome: () => void;
    legendRefresh: () => void;
    invokeCommand: (cmd: ICommand, parameters?: any) => void;
    setSelection: (mapName: string, selectionSet: any) => void;
    queryMapFeatures: (mapName: string, options: QueryMapFeatureActionOptions) => void;
}

type ViewerApiShimProps = IViewerApiShimProps & IViewerApiShimState & IViewerApiShimDispatch;

/**
 * This component installs a AJAX/Fusion viewer API compatibility layer when mounted allowing for existing
 * script content to work against this viewer.
 * 
 * @export
 * @class ViewerApiShim
 * @extends {React.Component<ViewerApiShimProps, any>}
 */
class ViewerApiShimInner extends React.Component<ViewerApiShimProps, any> {
    private userSelectionHandlers: SelectionHandlerCallback[];
    private us: boolean;
    private formFrame: FormFrameShim;
    private ol2API: OL2Shim;
    private fusionAPI: FusionApiShim;
    private fusionEventHandlers: { [id: number]: Function[] };

    constructor(props: ViewerApiShimProps) {
        super(props);
        this.us = true;
        this.userSelectionHandlers = [];
        this.fusionEventHandlers = {};
        this.ol2API = new OL2Shim();
        this.fusionAPI = new FusionApiShim(this);
    }
    private onFormFrameMounted = (form: FormFrameShim) => {
        this.formFrame = form;
    }
    getClient(): Client | undefined {
        const { agentUri, agentKind } = this.props;
        if (agentUri && agentKind) {
            return new Client(agentUri, agentKind);
        }
        return undefined;
    }
    // ------------------------ Fusion API support ----------------------- //
    getFusionAPI(): any { //any because I don't want to leak out the FusionApiShim internal class
        return this.fusionAPI;
    }
    public registerForEvent(eventID: number, callback: Function): void {
        debug(`Fusion registerForEvent - ${eventID}`);
        if (!this.fusionEventHandlers[eventID]) {
            this.fusionEventHandlers[eventID] = [];
        }
        this.fusionEventHandlers[eventID].push(callback);
    }
    public deregisterForEvent(eventID: number, callback: Function): void {
        debug(`Fusion deregisterForEvent - ${eventID}`);
        if (this.fusionEventHandlers[eventID]) {
            const funcs = this.fusionEventHandlers[eventID].filter(f => f != callback);
            this.fusionEventHandlers[eventID] = funcs;
        } else {
            debug(`No callbacks registered for fusion event - ${eventID}`);
        }
    }
    public triggerFusionEvent(eventID: number) {
        if (this.fusionEventHandlers[eventID]) {
            debug(`Trigger Fusion Event ID - ${eventID}`);
            for (const cb of this.fusionEventHandlers[eventID]) {
                cb.apply(null, arguments);
            }
        }
    }
    private fusionSelectionHandler(selection: QueryMapFeaturesResponse | undefined) {
        const eventID = isEmptySelection(selection) ? this.fusionAPI.Event.MAP_SELECTION_OFF : this.fusionAPI.Event.MAP_SELECTION_ON;
        this.triggerFusionEvent(eventID);
    }
    // ------------------------ Map Frame -------------------------------- //

    /**
     * Indicates if the map frame is ready
     *
     * Although this not part of the "public" API, most AJAX viewer examples test for this
     * flag anyways, so we might as well emulate it here
     */
    public get mapInit(): boolean { return this.props.map?.SessionId != null; }
    public ExecuteMapAction(code: AjaxViewerMapActionCode) {
        let cmdName: string;
        switch (code) {
            case AjaxViewerMapActionCode.About:
                cmdName = DefaultCommands.About;
                break;
            case AjaxViewerMapActionCode.ClearSelection:
                cmdName = DefaultCommands.ClearSelection;
                break;
            case AjaxViewerMapActionCode.InitialView:
                cmdName = DefaultCommands.ZoomExtents;
                break;
            case AjaxViewerMapActionCode.NextView:
                cmdName = DefaultCommands.NextView;
                break;
            case AjaxViewerMapActionCode.PanDown:
                cmdName = DefaultCommands.PanDown;
                break;
            case AjaxViewerMapActionCode.PanLeft:
                cmdName = DefaultCommands.PanLeft;
                break;
            case AjaxViewerMapActionCode.PanMode:
                cmdName = DefaultCommands.Pan;
                break;
            case AjaxViewerMapActionCode.PanRight:
                cmdName = DefaultCommands.PanRight;
                break;
            case AjaxViewerMapActionCode.PanUp:
                cmdName = DefaultCommands.PanUp;
                break;
            case AjaxViewerMapActionCode.PrevView:
                cmdName = DefaultCommands.PreviousView;
                break;
            case AjaxViewerMapActionCode.RefreshMap:
                cmdName = DefaultCommands.RefreshMap;
                break;
            case AjaxViewerMapActionCode.SelectionMode:
                cmdName = DefaultCommands.Select;
                break;
            case AjaxViewerMapActionCode.SelectPolygon:
                cmdName = DefaultCommands.SelectPolygon;
                break;
            case AjaxViewerMapActionCode.SelectRadius:
                cmdName = DefaultCommands.SelectRadius;
                break;
            case AjaxViewerMapActionCode.ZoomExtents:
                cmdName = DefaultCommands.ZoomExtents;
                break;
            case AjaxViewerMapActionCode.ZoomIn:
                cmdName = DefaultCommands.ZoomIn;
                break;
            case AjaxViewerMapActionCode.ZoomMode:
                cmdName = DefaultCommands.Zoom;
                break;
            case AjaxViewerMapActionCode.ZoomOut:
                cmdName = DefaultCommands.ZoomOut;
                break;
            case AjaxViewerMapActionCode.ZoomRect:
                cmdName = DefaultCommands.Zoom;
                break;
            case AjaxViewerMapActionCode.ZoomSelection:
                cmdName = DefaultCommands.ZoomToSelection;
                break;
            default:
                warn(`Unknown command code: ${code}`);
                return;
        }
        const cmd = getCommand(cmdName);
        if (cmd && this.props.invokeCommand) {
            this.props.invokeCommand(cmd);
        }
    }
    public ClearSelection(): void {
        getViewer()?.mapguideSupport()?.clearSelection();
    }
    public DigitizeCircle(handler: (circle: IAjaxViewerCircle) => void): void {
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizeCircle(circle => {
                const center = circle.getCenter();
                const radius = circle.getRadius();
                handler({
                    Center: {
                        X: center[0],
                        Y: center[1]
                    },
                    Radius: radius
                });
            });
        }
    }
    public DigitizeLine(handler: (geom: AjaxViewerLineStringOrPolygon) => void): void {
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizeLine(line => {
                const coords = line.getCoordinates().map<IAjaxViewerPoint>(coord => {
                    return {
                        X: coord[0],
                        Y: coord[1]
                    };
                });
                handler(new AjaxViewerLineStringOrPolygon(coords));
            });
        }
    }
    public DigitizePoint(handler: (geom: IAjaxViewerPoint) => void): void {
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizePoint(pt => {
                const coords = pt.getCoordinates();
                handler({ X: coords[0], Y: coords[1] });
            });
        }
    }
    public DigitizePolygon(handler: (geom: AjaxViewerLineStringOrPolygon) => void): void {
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizePolygon(poly => {
                //Our API isn't expected to allow drawing polygons with holes, so the first (outer) ring
                //is what we're after
                const ring = poly.getLinearRing(0);
                const coords = ring.getCoordinates().map<IAjaxViewerPoint>(coord => {
                    return {
                        X: coord[0],
                        Y: coord[1]
                    };
                });
                handler(new AjaxViewerLineStringOrPolygon(coords));
            });
        }
    }
    public DigitizeLineString(handler: (geom: AjaxViewerLineStringOrPolygon) => void): void {
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizeLineString(line => {
                const coords = line.getCoordinates().map<IAjaxViewerPoint>(coord => {
                    return {
                        X: coord[0],
                        Y: coord[1]
                    };
                });
                handler(new AjaxViewerLineStringOrPolygon(coords));
            });
        }
    }
    public DigitizeRectangle(handler: (geom: IAjaxViewerRect) => void): void {
        const viewer = getViewer();
        if (viewer) {
            viewer.digitizeRectangle(rect => {
                const extent = rect.getExtent();
                handler({
                    Point1: {
                        X: extent[0],
                        Y: extent[1]
                    },
                    Point2: {
                        X: extent[2],
                        Y: extent[3]
                    }
                });
            });
        }
    }
    public GetCenter(): IAjaxViewerPoint | null {
        const viewer = getViewer();
        if (viewer) {
            const view = viewer.getCurrentView();
            return { X: view.x, Y: view.y };
        }
        return null;
    }
    public GetLayers(onlyVisible: boolean, onlySelectable: boolean): IAjaxViewerLayer[] {
        const selLayers: IAjaxViewerLayer[] = [];
        const { map, selectionSet } = this.props;
        if (map && selectionSet && selectionSet.FeatureSet) {
            const fset: FeatureSet = selectionSet.FeatureSet;
            const ids = fset.Layer.map(l => l["@id"]);
            if (map.Layer) {
                for (const layer of map.Layer) {
                    if (ids.indexOf(layer.ObjectId) >= 0) {
                        if (onlyVisible === true && layer.Visible === true) {
                            selLayers.push({ legend: layer.LegendLabel, name: layer.Name, objectid: layer.ObjectId });
                        }
                        if (onlySelectable === true && layer.Selectable === true) {
                            selLayers.push({ legend: layer.LegendLabel, name: layer.Name, objectid: layer.ObjectId });
                        }
                    }
                }
            }
        }
        return selLayers;
    }
    public GetMetersPerUnit(): number | null {
        const viewer = getViewer();
        if (viewer) {
            return viewer.getMetersPerUnit();
        }
        return null;
    }
    public GetMapHeight(): number {
        const viewer = getViewer();
        if (viewer) {
            const [, gh] = viewer.getSize();
            return gh;
        }
        return NaN;
    }
    public GetMapName = (): string | undefined => this.props.map?.Name;
    public GetMapUnitsType(): string {
        const uom = getUnitOfMeasure(this.props.sizeUnits || UnitOfMeasure.Unknown);
        return uom.name;
    }
    public GetMapWidth(): number {
        const viewer = getViewer();
        if (viewer) {
            const [gw] = viewer.getSize();
            return gw;
        }
        return NaN;
    }
    public GetScale(): number | null {
        const viewer = getViewer();
        if (viewer) {
            const view = viewer.getCurrentView();
            return view.scale;
        }
        return null;
    }
    public GetSelectedLayers(): IAjaxViewerLayer[] {
        const selLayers: IAjaxViewerLayer[] = [];
        const { map, selectionSet } = this.props;
        if (map && selectionSet && selectionSet.FeatureSet) {
            const fset: FeatureSet = selectionSet.FeatureSet;
            const ids = fset.Layer.map(l => l["@id"]);
            if (map.Layer) {
                for (const layer of map.Layer) {
                    if (ids.indexOf(layer.ObjectId) >= 0) {
                        selLayers.push({ legend: layer.LegendLabel, name: layer.Name, objectid: layer.ObjectId });
                    }
                }
            }
        }
        return selLayers;
    }
    public GetSelectionXML(): string {
        const { selectionSet } = this.props;
        if (!selectionSet || !selectionSet.FeatureSet) {
            return "";
        } else {
            return buildSelectionXml(selectionSet.FeatureSet);
        }
    }
    public GetSessionId = (): string | undefined => this.props.map?.SessionId;
    public GetSelectedBounds(): IAjaxViewerBounds | null {
        let bounds: IAjaxViewerBounds | null = null;
        const { selectionSet } = this.props;
        if (selectionSet && selectionSet.SelectedFeatures) {
            const fset: SelectedFeatureSet = selectionSet.SelectedFeatures;
            fset.SelectedLayer.forEach(layer => {
                layer.Feature.forEach(feature => {
                    const bbox = feature.Bounds.split(" ").map(s => parseFloat(s));
                    if (bounds == null) {
                        bounds = { minx: bbox[0], miny: bbox[1], maxx: bbox[2], maxy: bbox[3] };
                    } else {
                        if (bbox[0] < bounds.minx)
                            bounds.minx = bbox[0];
                        if (bbox[1] < bounds.miny)
                            bounds.miny = bbox[1];
                        if (bbox[2] > bounds.maxx)
                            bounds.maxx = bbox[2];
                        if (bbox[3] > bounds.maxy)
                            bounds.maxy = bbox[3];
                    }
                });
            });
        }
        return bounds;
    }
    public GetSelectedCount(): number {
        let count = 0;
        const { selectionSet } = this.props;
        if (selectionSet && selectionSet.FeatureSet) {
            const fset: FeatureSet = selectionSet.FeatureSet;
            fset.Layer.forEach(layer => {
                layer.Class.ID.forEach(() => {
                    count++;
                });
            });
        }
        return count;
    }
    public GetSelectedFeatures(): IAjaxViewerSelectionSet | undefined {
        const viewer = getViewer()?.mapguideSupport();
        if (viewer) {
            const selection = viewer.getSelection();
            if (selection && selection.SelectedFeatures) {
                const sel: IAjaxViewerSelectionSet = {};
                for (const sl of selection.SelectedFeatures.SelectedLayer) {
                    sel[sl["@name"]] = sl.Feature.map(f => {
                        const bbox = f.Bounds.split(" ").map(s => parseFloat(s));
                        return {
                            zoom: { minx: bbox[0], miny: bbox[1], maxx: bbox[2], maxy: bbox[3] },
                            values: f.Property.map(p => ({ name: p.Name, value: p.Value }))
                        };
                    })
                }
                return sel;
            }
        }
    }
    public IsDigitizing(): boolean {
        const viewer = getViewer();
        if (viewer) {
            return viewer.isDigitizing();
        } else {
            return false;
        }
    }
    public IsEnglishUnits(): boolean {
        return this.us;
    }
    public IsLatLongDisplayUnits(): boolean {
        return true; //This is what the AJAX viewer returns
    }
    public MapUnitsToLatLon(): IAjaxViewerPoint {
        throw new MgError(`Un-implemented AJAX viewer shim API: map_frame.MapUnitsToLatLon(x, y)`);
    }
    public Refresh(): void {
        const viewer = getViewer();
        viewer?.refreshMap(RefreshMode.LayersOnly | RefreshMode.SelectionOnly);
        this.props.legendRefresh?.();
    }
    public ScreenToMapUnits(x: number, y: number): IAjaxViewerPoint | undefined {
        const viewer = getViewer();
        if (viewer) {
            const [sx, sy] = viewer.screenToMapUnits(x, y);
            return { X: sx, Y: sy };
        }
    }
    public SetEnglishUnits(usEnglish: boolean): void {
        this.us = usEnglish;
    }
    public SetLatLongDisplayUnits(): void {
        //This is what the AJAX viewer does
    }
    public SetSelectionXML(xmlSet: string): void {
        const viewer = getViewer()?.mapguideSupport();
        if (viewer) {
            viewer.setSelectionXml(xmlSet);
        }
    }
    public ZoomToView(x: number, y: number, scale: number) {
        const viewer = getViewer();
        if (viewer) {
            viewer.zoomToView(x, y, scale);
        }
    }
    public SetStatusMsg(msg: string): void {
        window.status = msg || ""; //Most browsers do nothing with window.status, but that is what this method does in the AJAX viewer
    }
    //This isn't in the AJAX Viewer API reference, but there are samples referencing it!
    public ZoomToScale(scale: number): void {
        const viewer = getViewer();
        if (viewer) {
            const view = viewer.getCurrentView();
            viewer.zoomToView(view.x, view.y, scale);
        }
    }
    //Form frame
    public Submit(url: string, params: string[], frameTarget: string) {
        this.formFrame.submit(url, params, frameTarget);
    }

    public goHome = () => this.props.goHome?.();

    private RegisterSelectionHandler(handler: SelectionHandlerCallback): number {
        this.userSelectionHandlers.push(handler);
        return this.userSelectionHandlers.length;
    }

    private UnregisterSelectionHandler(handler: SelectionHandlerCallback): number {
        this.userSelectionHandlers = this.userSelectionHandlers.filter(h => h != handler);
        return this.userSelectionHandlers.length;
    }

    private installShims(browserWindow: any) {
        browserWindow.Fusion = this.fusionAPI;
        browserWindow.OpenLayers = this.ol2API;

        browserWindow.GetMapFrame = browserWindow.GetMapFrame || (() => this);
        //NOTE: mapFrame is technically not part of the "public" API for the AJAX viewer, but since most examples test
        //for this in place of GetMapFrame(), we might as well emulate it here
        browserWindow.mapFrame = browserWindow.GetMapFrame();
        browserWindow.formFrame = browserWindow.mapFrame;

        browserWindow.ExecuteMapAction = browserWindow.ExecuteMapAction || ((code: any) => this.ExecuteMapAction(code));
        browserWindow.Refresh = browserWindow.Refresh || (() => this.Refresh());
        browserWindow.SetSelectionXML = browserWindow.SetSelectionXML || ((xmlSet: string) => this.SetSelectionXML(xmlSet));
        browserWindow.ZoomToView = browserWindow.ZoomToView || ((x: number, y: number, scale: number) => this.ZoomToView(x, y, scale));
        browserWindow.GotoHomePage = browserWindow.GotoHomePage || (() => this.goHome());

        // ======= Extended Viewer API ========== //
        browserWindow.GetViewerInterface = browserWindow.GetViewerInterface || (() => getViewer());
        browserWindow.RegisterSelectionHandler = browserWindow.RegisterSelectionHandler || ((handler: SelectionHandlerCallback) => this.RegisterSelectionHandler(handler));
        browserWindow.UnregisterSelectionHandler = browserWindow.UnregisterSelectionHandler || ((handler: SelectionHandlerCallback) => this.UnregisterSelectionHandler(handler));
    }
    componentDidMount() {
        //Install shims into browser window
        let browserWindow: any = window;
        this.installShims(browserWindow);
        this.installShims(window.parent);

        this.RegisterSelectionHandler((_mapName: string, selection: QueryMapFeaturesResponse | undefined) => {
            this.fusionSelectionHandler(selection);
        });
    }
    componentDidUpdate(prevProps: ViewerApiShimProps) {
        const nextProps = this.props;
        if (nextProps.map && nextProps.selectionSet != prevProps.selectionSet) {
            for (const handler of this.userSelectionHandlers) {
                handler(nextProps.map.Name, nextProps.selectionSet ?? undefined);
            }
        }
        if (nextProps.busyCount != prevProps.busyCount) {
            this.triggerFusionEvent(this.fusionAPI.Event.MAP_BUSY_CHANGED);
        }
    }
    render(): JSX.Element {
        //This is for all intents and purposes, a "background" component. There is no real DOM representation
        return <div>
            <FormFrameShim ref={this.onFormFrameMounted} />
        </div>;
    }
}

export const ViewerApiShim = () => {
    const map = useActiveMapState();
    const selectionSet = useActiveMapSelectionSet();
    const agentUri = useConfiguredAgentUri();
    const agentKind = useConfiguredAgentKind();
    const busyCount = useViewerBusyCount();
    const sizeUnits = useViewerSizeUnits();

    const dispatch = useReduxDispatch();
    const goHomeAction = () => dispatch(goHome());
    const legendRefresh = () => dispatch(refresh());
    const invokeCommandAction = (cmd: ICommand, parameters: any) => dispatch(invokeCommand(cmd, parameters));
    const setSelectionAction = (mapName: string, res: any) => dispatch(setSelection(mapName, res));
    const queryMapFeaturesAction = (mapName: string, options: QueryMapFeatureActionOptions) => dispatch(queryMapFeatures(mapName, options));

    return <ViewerApiShimInner map={map}
        selectionSet={selectionSet}
        agentUri={agentUri}
        agentKind={agentKind}
        busyCount={busyCount}
        sizeUnits={sizeUnits}
        goHome={goHomeAction}
        legendRefresh={legendRefresh}
        invokeCommand={invokeCommandAction}
        setSelection={setSelectionAction}
        queryMapFeatures={queryMapFeaturesAction} />;
}