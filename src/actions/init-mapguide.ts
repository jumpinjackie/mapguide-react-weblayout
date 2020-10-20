import { ApplicationDefinition, MapConfiguration } from '../api/contracts/fusion';
import { RuntimeMap } from '../api/contracts/runtime-map';
import { Dictionary, IExternalBaseLayer, ReduxDispatch, ActiveMapTool, IMapView } from '../api/common';
import { MapInfo, IInitAppActionPayload, IRestoredSelectionSets } from './defs';
import { tr, DEFAULT_LOCALE } from '../api/i18n';
import { strEndsWith } from '../utils/string';
import { Client } from '../api/client';
import { IInitAsyncOptions, processLayerInMapGroup } from './init';
import { RuntimeMapFeatureFlags } from '../api/request-builder';
import { info, debug } from '../utils/logger';
import { MgError } from '../api/error';
import { resolveProjectionFromEpsgIoAsync } from '../api/registry/projections';
import { register } from 'ol/proj/proj4';
import proj4 from "proj4";
import { ViewerInitCommand } from './init-command';
import { WebLayout, isInvokeURLCommand, isSearchCommand } from '../api/contracts/weblayout';
import { ToolbarConf } from '../api/registry/command-spec';
import { clearSessionStore, retrieveSelectionSetFromLocalStorage } from '../api/session-store';
import { WEBLAYOUT_CONTEXTMENU, WEBLAYOUT_TASKMENU, WEBLAYOUT_TOOLBAR } from "../constants";
import { registerCommand } from '../api/registry/command';
import { ensureParameters } from '../utils/url';
import { assertIsDefined } from '../utils/assert';
import { generateId } from '../utils/id-gen';

export class MapGuideViewerInitCommand extends ViewerInitCommand<RuntimeMap> {
    private client: Client | undefined;
    private options: IInitAsyncOptions;
    constructor(dispatch: ReduxDispatch) {
        super(dispatch);
    }
    public attachClient(client: Client): void {
        this.client = client;
    }
    /**
     * @override
     * @protected
     * @param {Dictionary<RuntimeMap>} mapsByName
     * @memberof MgViewerInitCommand
     */
    protected establishInitialMapNameAndSession(mapsByName: Dictionary<RuntimeMap>): [string, string] {
        let firstMapName = "";
        let firstSessionId = "";
        for (const mapName in mapsByName) {
            if (!firstMapName && !firstSessionId) {
                const map = mapsByName[mapName];
                firstMapName = map.Name;
                firstSessionId = map.SessionId;
                break;
            }
        }
        return [firstMapName, firstSessionId];
    }
    private getDesiredTargetMapName(mapDef: string) {
        const lastSlash = mapDef.lastIndexOf("/");
        const lastDot = mapDef.lastIndexOf(".");
        if (lastSlash >= 0 && lastDot >= 0 && lastDot > lastSlash) {
            return `${mapDef.substring(lastSlash + 1, lastDot)}`;
        } else {
            return `Map_${generateId()}`;
        }
    }
    private async initFromWebLayoutAsync(webLayout: WebLayout, session: string, sessionWasReused: boolean): Promise<IInitAppActionPayload> {
        const [mapsByName, warnings] = await this.createRuntimeMapsAsync(session, webLayout, wl => [{ name: this.getDesiredTargetMapName(wl.Map.ResourceId), mapDef: wl.Map.ResourceId }], () => [], sessionWasReused);
        const cmdsByKey: any = {};
        const { locale, featureTooltipsEnabled, externalBaseLayers } = this.options;
        //Register any InvokeURL and Search commands
        for (const cmd of webLayout.CommandSet.Command) {
            if (isInvokeURLCommand(cmd)) {
                registerCommand(cmd.Name, {
                    url: cmd.URL,
                    disableIfSelectionEmpty: cmd.DisableIfSelectionEmpty,
                    target: cmd.Target,
                    targetFrame: cmd.TargetFrame,
                    parameters: (cmd.AdditionalParameter || []).map(p => {
                        return { name: p.Key, value: p.Value };
                    }),
                    title: cmd.Label
                });
            } else if (isSearchCommand(cmd)) {
                registerCommand(cmd.Name, {
                    layer: cmd.Layer,
                    prompt: cmd.Prompt,
                    target: cmd.Target,
                    targetFrame: cmd.TargetFrame,
                    resultColumns: cmd.ResultColumns,
                    filter: cmd.Filter,
                    matchLimit: cmd.MatchLimit,
                    title: cmd.Label
                });
            }
            cmdsByKey[cmd.Name] = cmd;
        }
        const mainToolbar = (webLayout.ToolBar.Visible
            ? this.convertWebLayoutUIItems(webLayout.ToolBar.Button, cmdsByKey, locale)
            : []);
        const taskBar = (webLayout.TaskPane.TaskBar.Visible
            ? this.convertWebLayoutUIItems(webLayout.TaskPane.TaskBar.MenuButton, cmdsByKey, locale, false)
            : []);
        const contextMenu = (webLayout.ContextMenu.Visible
            ? this.convertWebLayoutUIItems(webLayout.ContextMenu.MenuItem, cmdsByKey, locale, false)
            : []);
        const config: any = {};
        if (webLayout.SelectionColor != null) {
            config.selectionColor = webLayout.SelectionColor;
        }
        if (webLayout.MapImageFormat != null) {
            config.imageFormat = webLayout.MapImageFormat;
        }
        if (webLayout.SelectionImageFormat != null) {
            config.selectionImageFormat = webLayout.SelectionImageFormat;
        }
        if (webLayout.PointSelectionBuffer != null) {
            config.pointSelectionBuffer = webLayout.PointSelectionBuffer;
        }
        let initialView: IMapView | null = null;
        if (webLayout.Map.InitialView != null) {
            initialView = {
                x: webLayout.Map.InitialView.CenterX,
                y: webLayout.Map.InitialView.CenterY,
                scale: webLayout.Map.InitialView.Scale
            };
        }

        if (webLayout.Title != "") {
            document.title = webLayout.Title || document.title;
        }

        const maps: any = {};
        let firstMapName = "";
        let firstSessionId = "";
        for (const mapName in mapsByName) {
            if (!firstMapName && !firstSessionId) {
                const map = mapsByName[mapName];
                firstMapName = map.Name;
                firstSessionId = map.SessionId;
                maps[firstMapName] = {
                    mapGroupId: map.Name,
                    map: map,
                    externalBaseLayers: externalBaseLayers,
                    initialView: initialView
                };
                break;
            }
        }

        const menus: Dictionary<ToolbarConf> = {};
        menus[WEBLAYOUT_TOOLBAR] = {
            items: mainToolbar
        };
        menus[WEBLAYOUT_TASKMENU] = {
            items: taskBar
        };
        menus[WEBLAYOUT_CONTEXTMENU] = {
            items: contextMenu
        };

        const tb = this.prepareSubMenus(menus)[0];
        return {
            activeMapName: firstMapName,
            featureTooltipsEnabled: featureTooltipsEnabled,
            initialUrl: ensureParameters(webLayout.TaskPane.InitialTask || "server/TaskPane.html", firstMapName, firstSessionId, locale),
            initialTaskPaneWidth: webLayout.TaskPane.Width,
            initialInfoPaneWidth: webLayout.InformationPane.Width,
            maps: maps,
            locale: locale,
            config: config,
            capabilities: {
                hasTaskPane: webLayout.TaskPane.Visible,
                hasTaskBar: webLayout.TaskPane.TaskBar.Visible,
                hasStatusBar: webLayout.StatusBar.Visible,
                hasNavigator: webLayout.ZoomControl.Visible,
                hasSelectionPanel: webLayout.InformationPane.Visible && webLayout.InformationPane.PropertiesVisible,
                hasLegend: webLayout.InformationPane.Visible && webLayout.InformationPane.LegendVisible,
                hasToolbar: webLayout.ToolBar.Visible,
                hasViewSize: webLayout.StatusBar.Visible
            },
            toolbars: tb,
            warnings: warnings,
            initialActiveTool: ActiveMapTool.Pan
        };
    }
    private async tryDescribeRuntimeMapAsync(mapName: string, session: string, mapDef: string) {
        assertIsDefined(this.client);
        try {
            const map = await this.client.describeRuntimeMap({
                mapname: mapName,
                requestedFeatures: RuntimeMapFeatureFlags.LayerFeatureSources | RuntimeMapFeatureFlags.LayerIcons | RuntimeMapFeatureFlags.LayersAndGroups,
                session: session
            });
            return map;
        } catch (e) {
            if (e.message === "MgResourceNotFoundException") {
                const map = await this.client.createRuntimeMap({
                    mapDefinition: mapDef,
                    requestedFeatures: RuntimeMapFeatureFlags.LayerFeatureSources | RuntimeMapFeatureFlags.LayerIcons | RuntimeMapFeatureFlags.LayersAndGroups,
                    session: session,
                    targetMapName: mapName
                });
                return map;
            }
            throw e;
        }
    }
    private async createRuntimeMapsAsync<TLayout>(session: string, res: TLayout, mapDefSelector: (res: TLayout) => MapToLoad[], projectionSelector: (res: TLayout) => string[], sessionWasReused: boolean): Promise<[Dictionary<RuntimeMap>, string[]]> {
        assertIsDefined(this.client);
        const mapDefs = mapDefSelector(res);
        const mapPromises: Promise<RuntimeMap>[] = [];
        const warnings = [] as string[];
        const { locale } = this.options;
        for (const m of mapDefs) {
            //sessionWasReused is a hint whether to create a new runtime map, or recover the last runtime map state from the given map name
            if (sessionWasReused) {
                //FIXME: If the map state we're recovering has a selection, we need to re-init the selection client-side
                info(`Session ID re-used. Attempting recovery of map state of: ${m.name}`);
                mapPromises.push(this.tryDescribeRuntimeMapAsync(m.name, session, m.mapDef));
            } else {
                info(`Creating runtime map state (${m.name}) for: ${m.mapDef}`);
                mapPromises.push(this.client.createRuntimeMap({
                    mapDefinition: m.mapDef,
                    requestedFeatures: RuntimeMapFeatureFlags.LayerFeatureSources | RuntimeMapFeatureFlags.LayerIcons | RuntimeMapFeatureFlags.LayersAndGroups,
                    session: session,
                    targetMapName: m.name
                }));
            }
        }
        const maps = await Promise.all(mapPromises);
        const fetchEpsgs: { epsg: string, mapDef: string }[] = [];
        //All must be non-zero
        for (const m of maps) {
            const epsg = m.CoordinateSystem.EpsgCode;
            const mapDef = m.MapDefinition;
            if (epsg == "0") {
                throw new MgError(tr("INIT_ERROR_UNSUPPORTED_COORD_SYS", locale || DEFAULT_LOCALE, { mapDefinition: mapDef }));
            }
            //Must be registered to proj4js if not 4326 or 3857
            if (!proj4.defs[`EPSG:${epsg}`]) {
                fetchEpsgs.push({ epsg: epsg, mapDef: mapDef });
            }
        }
        const extraEpsgs = projectionSelector(res);
        for (const e of extraEpsgs) {
            fetchEpsgs.push({ epsg: e, mapDef: "" });
        }
        const epsgs = await Promise.all(fetchEpsgs.map(f => resolveProjectionFromEpsgIoAsync(f.epsg, locale, f.mapDef)));

        //Previously, we register proj4 with OpenLayers on the bootstrap phase way before this init
        //process is started. This no longer works for OL6 where it doesn't seem to pick up the extra
        //projections we've registered with proj4 after linking proj4 to OpenLayers. So that registration
        //step has been relocated here, after all the custom projections have been fetched and registered
        //with proj4
        debug(`Register proj4 with OpenLayers`);
        register(proj4);

        //Build the Dictionary<RuntimeMap> from loaded maps
        const mapsByName: Dictionary<RuntimeMap> = {};
        for (const map of maps) {
            mapsByName[map.Name] = map;
        }
        return [mapsByName, warnings];
    }
    /**
     * @override
     * @protected
     * @param {ApplicationDefinition} appDef
     * @param {Dictionary<RuntimeMap>} mapsByName
     * @param {*} config
     * @param {string[]} warnings
     * @returns {Dictionary<MapInfo>}
     * @memberof MgViewerInitCommand
     */
    protected setupMaps(appDef: ApplicationDefinition, mapsByName: Dictionary<RuntimeMap>, config: any, warnings: string[]): Dictionary<MapInfo> {
        const dict: Dictionary<MapInfo> = {};
        if (appDef.MapSet) {
            for (const mGroup of appDef.MapSet.MapGroup) {
                let mapName: string | undefined;
                //Setup external layers
                const externalBaseLayers = [] as IExternalBaseLayer[];
                for (const map of mGroup.Map) {
                    if (map.Type === "MapGuide") {
                        //TODO: Based on the schema, different MG map groups could have different
                        //settings here and our redux tree should reflect that. Currently the first one "wins"
                        if (!config.selectionColor && map.Extension.SelectionColor != null) {
                            config.selectionColor = map.Extension.SelectionColor;
                        }
                        if (!config.imageFormat && map.Extension.ImageFormat != null) {
                            config.imageFormat = map.Extension.ImageFormat;
                        }
                        if (!config.selectionImageFormat && map.Extension.SelectionFormat != null) {
                            config.selectionImageFormat = map.Extension.SelectionFormat;
                        }

                        //NOTE: Although non-sensical, if the same map definition exists across multiple
                        //MapGroups, we might be matching the wrong one. We just assume such non-sensical
                        //AppDefs won't exist
                        for (const name in mapsByName) {
                            if (mapsByName[name].MapDefinition == map.Extension.ResourceId) {
                                mapName = name;
                                break;
                            }
                        }
                    } else {
                        processLayerInMapGroup(map, warnings, config, appDef, externalBaseLayers);
                    }
                }
                //First come, first served
                if (externalBaseLayers.length > 0) {
                    externalBaseLayers[0].visible = true;
                }

                //Setup initial view
                let initialView: IMapView | undefined;
                if (mGroup.InitialView) {
                    initialView = {
                        x: mGroup.InitialView.CenterX,
                        y: mGroup.InitialView.CenterY,
                        scale: mGroup.InitialView.Scale
                    };
                }

                if (mapName) {
                    dict[mapName] = {
                        mapGroupId: mGroup["@id"],
                        map: mapsByName[mapName],
                        initialView: initialView,
                        externalBaseLayers: externalBaseLayers,
                        initialExternalLayers: []
                    };
                }
            }
        }
        return dict;
    }
    private async initFromAppDefAsync(appDef: ApplicationDefinition, session: string, sessionWasReused: boolean): Promise<IInitAppActionPayload> {
        const [mapsByName, warnings] = await this.createRuntimeMapsAsync(session, appDef, fl => getMapDefinitionsFromFlexLayout(fl), fl => this.getExtraProjectionsFromFlexLayout(fl), sessionWasReused);
        return await this.initFromAppDefCoreAsync(appDef, this.options, mapsByName, warnings);
    }
    private async sessionAcquiredAsync(session: string, sessionWasReused: boolean): Promise<IInitAppActionPayload> {
        assertIsDefined(this.client);
        const { resourceId, locale } = this.options;
        if (!resourceId) {
            throw new MgError(tr("INIT_ERROR_MISSING_RESOURCE_PARAM", locale));
        } else {
            if (typeof (resourceId) == 'string') {
                if (strEndsWith(resourceId, "WebLayout")) {
                    const wl = await this.client.getResource<WebLayout>(resourceId, { SESSION: session });
                    return await this.initFromWebLayoutAsync(wl, session, sessionWasReused);
                } else if (strEndsWith(resourceId, "ApplicationDefinition")) {
                    const fl = await this.client.getResource<ApplicationDefinition>(resourceId, { SESSION: session });
                    return await this.initFromAppDefAsync(fl, session, sessionWasReused);
                } else {
                    throw new MgError(tr("INIT_ERROR_UNKNOWN_RESOURCE_TYPE", locale, { resourceId: resourceId }));
                }
            } else {
                const fl = await resourceId();
                return await this.initFromAppDefAsync(fl, session, sessionWasReused);
            }
        }
    }
    public async runAsync(options: IInitAsyncOptions): Promise<IInitAppActionPayload> {
        assertIsDefined(this.client);
        this.options = options;
        let session = this.options.session;
        await this.initLocaleAsync(this.options);
        let sessionWasReused = false;
        if (!session) {
            session = await this.client.createSession("Anonymous", "");
        } else {
            info(`Re-using session: ${session}`);
            sessionWasReused = true;
        }
        const payload = await this.sessionAcquiredAsync(session, sessionWasReused);
        if (sessionWasReused) {
            let initSelections: IRestoredSelectionSets = {};
            for (const mapName in payload.maps) {
                const sset = await retrieveSelectionSetFromLocalStorage(session, mapName);
                if (sset) {
                    initSelections[mapName] = sset;
                }
            }
            payload.initialSelections = initSelections;
            try {
                //In the interest of being a responsible citizen, clean up all selection-related stuff from
                //session store
                await clearSessionStore();
            } catch (e) {

            }
        }
        return payload;
    }
}

function getMapGuideConfiguration(appDef: ApplicationDefinition): [string, MapConfiguration][] {
    const configs = [] as [string, MapConfiguration][];
    if (appDef.MapSet) {
        for (const mg of appDef.MapSet.MapGroup) {
            for (const map of mg.Map) {
                if (map.Type == "MapGuide") {
                    configs.push([mg["@id"], map]);
                }
            }
        }
    }
    return configs;
}

export function getMapDefinitionsFromFlexLayout(appDef: ApplicationDefinition): MapToLoad[] {
    const configs = getMapGuideConfiguration(appDef);
    if (configs.length > 0) {
        return configs.map(c => ({ name: c[0], mapDef: c[1].Extension.ResourceId }));
    }
    throw new MgError("No Map Definition found in Application Definition");
}

export type MapToLoad = { name: string, mapDef: string };