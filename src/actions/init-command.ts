import { IInitAsyncOptions } from './init';
import { ReduxDispatch, Dictionary, CommandTarget, ActiveMapTool } from '../api/common';
import { IInitAppActionPayload, MapInfo } from './defs';
import { IFlyoutSpec, ISeparatorSpec, IUnknownCommandSpec, ICommandSpec, convertWidget, ToolbarConf, PreparedSubMenuSet, isFlyoutSpec } from '../api/registry/command-spec';
import { makeUnique } from '../utils/array';
import { UIWidget, ContainerItem, Widget, ApplicationDefinition } from '../api/contracts/fusion';
import { assertNever } from '../utils/never';
import { strIsNullOrEmpty } from '../utils/string';
import { SPRITE_INVOKE_URL, SPRITE_INVOKE_SCRIPT } from '../constants/assets';
import { UIItem, CommandDef, isCommandItem, isTargetedCommand, isBasicCommand, isSeparatorItem, isFlyoutItem } from '../api/contracts/weblayout';
import { warn, info } from '../utils/logger';
import { DefaultCommands, registerCommand } from '../api/registry/command';
import { tr, registerStringBundle, DEFAULT_LOCALE } from '../api/i18n';
import { WEBLAYOUT_CONTEXTMENU, WEBLAYOUT_TASKMENU } from "../constants";
import { Client } from '../api/client';
import { ActionType } from '../constants/actions';
import { ensureParameters } from '../utils/url';
import { generateId } from '../utils/id-gen';

export interface IViewerInitCommand {
    attachClient(client: Client): void;
    runAsync(options: IInitAsyncOptions): Promise<IInitAppActionPayload>;
}

export abstract class ViewerInitCommand<TSubject> implements IViewerInitCommand {
    constructor(protected readonly dispatch: ReduxDispatch) { }
    public abstract attachClient(client: Client): void;
    public abstract runAsync(options: IInitAsyncOptions): Promise<IInitAppActionPayload>;
    protected abstract establishInitialMapNameAndSession(mapsByName: Dictionary<TSubject>): [string, string];
    protected abstract setupMaps(appDef: ApplicationDefinition, mapsByName: Dictionary<TSubject>, config: any, warnings: string[]): Dictionary<MapInfo>;
    protected async initLocaleAsync(options: IInitAsyncOptions): Promise<void> {
        //English strings are baked into this bundle. For non-en locales, we assume a strings/{locale}.json
        //exists for us to fetch
        const { locale } = options;
        if (locale != DEFAULT_LOCALE) {
            const r = await fetch(`strings/${locale}.json`);
            if (r.ok) {
                const res = await r.json();
                registerStringBundle(locale, res);
                // Dispatch the SET_LOCALE as it is safe to change UI strings at this point
                this.dispatch({
                    type: ActionType.SET_LOCALE,
                    payload: locale
                });
                info(`Registered string bundle for locale: ${locale}`);
            } else {
                //TODO: Push warning to init error/warning reducer when we implement it
                warn(`Failed to register string bundle for locale: ${locale}`);
            }
        }
    }
    protected tryTranslateImageUrlToSpriteClass(imageUrl: string): string | undefined {
        switch (imageUrl) {
            case "../stdicons/icon_invokeurl.gif":
                return SPRITE_INVOKE_URL;
            case "../stdicons/icon_invokescript.gif":
                return SPRITE_INVOKE_SCRIPT;
        }
    }
    protected isUIWidget(widget: any): widget is UIWidget {
        return widget.WidgetType === "UiWidgetType";
    }
    protected convertFlexLayoutUIItems(items: ContainerItem[], widgetsByKey: Dictionary<Widget>, locale: string, noToolbarLabels = false): (IFlyoutSpec | ISeparatorSpec | IUnknownCommandSpec | ICommandSpec)[] {
        const converted = items.map(item => {
            switch (item.Function) {
                case "Widget":
                    {
                        const widget = widgetsByKey[item.Widget];
                        if (widget && this.isUIWidget(widget)) {
                            return convertWidget(widget, locale, noToolbarLabels);
                        }
                    }
                case "Separator":
                    return { isSeparator: true } as ISeparatorSpec;
                case "Flyout":
                    return {
                        label: item.Label,
                        tooltip: item.Tooltip,
                        icon: item.ImageUrl,
                        spriteClass: item.ImageClass,
                        children: this.convertFlexLayoutUIItems(item.Item, widgetsByKey, locale)
                    } as IFlyoutSpec;
                default:
                    assertNever(item);
            }
            return null;
        })
            .filter(i => i != null)
            .map(i => i as (IFlyoutSpec | ISeparatorSpec | IUnknownCommandSpec | ICommandSpec));
        return converted;
    }

    protected convertToCommandTarget(fusionCmdTarget: string): CommandTarget {
        //Treat empty/undefined target as new window
        if (strIsNullOrEmpty(fusionCmdTarget)) {
            return "NewWindow";
        }
        switch (fusionCmdTarget) {
            case "SearchWindow":
            case "InvokeUrlWindow":
                return "NewWindow";
            case "TaskPane":
                return "TaskPane";
            default:
                return "SpecifiedFrame";
        }
    }
    protected getExtraProjectionsFromFlexLayout(appDef: ApplicationDefinition): string[] {
        //The only widget we care about is the coordinate tracker
        const epsgs: string[] = [];
        for (const ws of appDef.WidgetSet) {
            for (const w of ws.Widget) {
                if (w.Type == "CoordinateTracker") {
                    const ps = w.Extension.Projection || [];
                    for (const p of ps) {
                        epsgs.push(p.split(':')[1]);
                    }
                } else if (w.Type == "CursorPosition") {
                    const dp = w.Extension.DisplayProjection;
                    if (dp) {
                        epsgs.push(dp.split(':')[1]);
                    }
                }
            }
        }
        return makeUnique(epsgs);
    }
    protected convertWebLayoutUIItems(items: UIItem[] | undefined, cmdsByKey: Dictionary<CommandDef>, locale: string, noToolbarLabels = true): (IFlyoutSpec | ISeparatorSpec | IUnknownCommandSpec | ICommandSpec)[] {
        const converted = (items || []).map(item => {
            if (isCommandItem(item)) {
                const cmdDef: CommandDef = cmdsByKey[item.Command];
                if (!cmdDef) {
                    warn(`Invalid reference to command: ${item.Command}`);
                    return { error: tr("UNKNOWN_COMMAND_REFERENCE", locale, { command: item.Command }) } as IUnknownCommandSpec;
                } else if (cmdDef.TargetViewer != "Dwf") {
                    let icon: Partial<Pick<ICommandSpec, "icon" | "spriteClass">> = {};
                    if (cmdDef.ImageURL) {
                        icon.spriteClass = this.tryTranslateImageUrlToSpriteClass(cmdDef.ImageURL);
                        if (!icon.spriteClass) {
                            icon.icon = cmdDef.ImageURL;
                        }
                    }
                    const commonParams: any = {};
                    if (isTargetedCommand(cmdDef)) {
                        commonParams.Target = cmdDef.Target;
                        commonParams.TargetFrame = cmdDef.TargetFrame;
                    }
                    if (isBasicCommand(cmdDef)) {
                        let action: string = cmdDef.Action;
                        if (action == "ZoomRectangle") {
                            action = DefaultCommands.Zoom;
                        } else if (action == "FitToWindow") {
                            action = DefaultCommands.ZoomExtents;
                        } else if (action == "Refresh") {
                            action = DefaultCommands.RefreshMap;
                        }
                        return { command: action, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip, parameters: commonParams, ...icon };
                    } else {
                        switch (cmdDef["@xsi:type"]) {
                            case "ViewOptionsCommandType":
                                return { command: DefaultCommands.ViewerOptions, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip, parameters: commonParams };
                            case "MeasureCommandType":
                                return { command: DefaultCommands.Measure, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip, parameters: commonParams };
                            case "HelpCommandType":
                                return { command: DefaultCommands.Help, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip, parameters: commonParams };
                            case "BufferCommandType":
                                return { command: DefaultCommands.Buffer, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip, parameters: commonParams };
                            case "SelectWithinCommandType":
                                return { command: DefaultCommands.SelectWithin, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip, parameters: commonParams };
                            case "GetPrintablePageCommandType":
                                return { command: DefaultCommands.QuickPlot, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip, parameters: commonParams };
                            default:
                                return { command: cmdDef.Name, label: (noToolbarLabels ? null : cmdDef.Label), tooltip: cmdDef.Tooltip, parameters: commonParams, ...icon };
                        }
                    }
                }
            } else if (isSeparatorItem(item)) {
                return { isSeparator: true } as ISeparatorSpec;
            } else if (isFlyoutItem(item)) {
                return {
                    label: item.Label,
                    tooltip: item.Tooltip,
                    children: this.convertWebLayoutUIItems(item.SubItem, cmdsByKey, locale, false)
                } as IFlyoutSpec;
            } else {
                assertNever(item);
            }
            return null;
        })
            .filter(i => i != null)
            .map(i => i as (IFlyoutSpec | ISeparatorSpec | IUnknownCommandSpec | ICommandSpec));
        return converted;
    }
    protected prepareSubMenus(tbConf: Dictionary<ToolbarConf>): [PreparedSubMenuSet, boolean] {
        const prepared: PreparedSubMenuSet = {
            toolbars: {},
            flyouts: {}
        };
        let bFoundContextMenu = false;
        for (const key in tbConf) {
            if (key == WEBLAYOUT_CONTEXTMENU) {
                bFoundContextMenu = true;
            }

            //Special cases: Task pane and Context Menu. Transfer all to flyout
            if (key == WEBLAYOUT_TASKMENU || key == WEBLAYOUT_CONTEXTMENU) {
                const flyoutId = key;
                prepared.flyouts[flyoutId] = {
                    children: tbConf[key].items
                }
            } else {
                prepared.toolbars[key] = {
                    items: []
                };
                for (const item of tbConf[key].items) {
                    //Special case: contextmenu is all inline
                    if (isFlyoutSpec(item) && key != WEBLAYOUT_CONTEXTMENU) {
                        const flyoutId = `${item.label}_${generateId()}`;
                        prepared.toolbars[key].items.push({
                            label: item.label,
                            tooltip: item.tooltip,
                            icon: item.icon,
                            spriteClass: item.spriteClass,
                            flyoutId: flyoutId
                        } as ICommandSpec);
                        prepared.flyouts[flyoutId] = {
                            children: item.children
                        }
                    } else {
                        prepared.toolbars[key].items.push(item);
                    }
                }
            }
        }
        return [prepared, bFoundContextMenu]
    }
    protected async initFromAppDefCoreAsync(appDef: ApplicationDefinition, options: IInitAsyncOptions, mapsByName: Dictionary<TSubject>, warnings: string[]): Promise<IInitAppActionPayload> {
        let initialTask: string;
        let taskPane: Widget | undefined;
        let viewSize: Widget | undefined;
        let hasLegend = false;
        let hasStatus = false;
        let hasNavigator = false;
        let hasSelectionPanel = false;
        let hasTaskBar = false;
        const { locale, featureTooltipsEnabled } = options;
        const config: any = {};
        const tbConf: Dictionary<ToolbarConf> = {};
        const widgetsByKey: Dictionary<Widget> = {};
        //Register any InvokeURL and Search commands. Also set capabilities along the way
        for (const widgetSet of appDef.WidgetSet) {
            for (const widget of widgetSet.Widget) {
                const cmd = widget.Extension;
                switch (widget.Type) {
                    case "TaskPane":
                        taskPane = widget;
                        break;
                    case "ViewSize":
                        viewSize = widget;
                        break;
                    case "Legend":
                        hasLegend = true;
                        break;
                    case "SelectionPanel":
                        hasSelectionPanel = true;
                        break;
                    case "CursorPosition":
                    case "SelectionInfo":
                        hasStatus = true;
                        break;
                    case "Navigator":
                        hasNavigator = true;
                        break;
                    case "Search":
                        registerCommand(widget.Name, {
                            layer: cmd.Layer,
                            prompt: cmd.Prompt,
                            resultColumns: cmd.ResultColumns,
                            filter: cmd.Filter,
                            matchLimit: cmd.MatchLimit,
                            title: (cmd.Title || (this.isUIWidget(widget) ? widget.Label : undefined)),
                            target: this.convertToCommandTarget(cmd.Target),
                            targetFrame: cmd.Target
                        });
                        break;
                    case "InvokeURL":
                        registerCommand(widget.Name, {
                            url: cmd.Url,
                            disableIfSelectionEmpty: cmd.DisableIfSelectionEmpty,
                            target: this.convertToCommandTarget(cmd.Target),
                            targetFrame: cmd.Target,
                            parameters: (cmd.AdditionalParameter || []).map((p: any) => {
                                return { name: p.Key, value: p.Value };
                            }),
                            title: this.isUIWidget(widget) ? widget.Label : undefined
                        });
                        break;
                }
                widgetsByKey[widget.Name] = widget;
            }
        }
        //Now build toolbar layouts
        for (const widgetSet of appDef.WidgetSet) {
            for (const cont of widgetSet.Container) {
                let tbName = cont.Name;
                tbConf[tbName] = { items: this.convertFlexLayoutUIItems(cont.Item, widgetsByKey, locale) };
            }
            for (const w of widgetSet.Widget) {
                if (w.Type == "CursorPosition") {
                    config.coordinateProjection = w.Extension.DisplayProjection;
                    config.coordinateDecimals = w.Extension.Precision;
                    config.coordinateDisplayFormat = w.Extension.Template;
                }
            }
        }

        const maps = this.setupMaps(appDef, mapsByName, config, warnings);

        if (taskPane) {
            hasTaskBar = true; //Fusion flex layouts can't control the visiblity of this
            initialTask = taskPane.Extension.InitialTask || "server/TaskPane.html";
        } else {
            initialTask = "server/TaskPane.html";
        }

        if (appDef.Title) {
            document.title = appDef.Title || document.title;
        }

        const [firstMapName, firstSessionId] = this.establishInitialMapNameAndSession(mapsByName);
        const [tb, bFoundContextMenu] = this.prepareSubMenus(tbConf);
        if (!bFoundContextMenu) {
            warnings.push(tr("INIT_WARNING_NO_CONTEXT_MENU", locale, { containerName: WEBLAYOUT_CONTEXTMENU }));
        }
        return {
            activeMapName: firstMapName,
            initialUrl: ensureParameters(initialTask, firstMapName, firstSessionId, locale),
            featureTooltipsEnabled: featureTooltipsEnabled,
            locale: locale,
            maps: maps,
            config: config,
            capabilities: {
                hasTaskPane: (taskPane != null),
                hasTaskBar: hasTaskBar,
                hasStatusBar: hasStatus,
                hasNavigator: hasNavigator,
                hasSelectionPanel: hasSelectionPanel,
                hasLegend: hasLegend,
                hasToolbar: (Object.keys(tbConf).length > 0),
                hasViewSize: (viewSize != null)
            },
            toolbars: tb,
            warnings: warnings,
            initialActiveTool: ActiveMapTool.Pan
        };
    }
}