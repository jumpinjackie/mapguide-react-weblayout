import { UIWidget } from '../contracts/fusion';
import { DefaultCommands } from './command';
import { DefaultComponentNames } from './component';
import { tr } from '../i18n';
import { Dictionary } from '../common';
import { generateId } from '../../utils/id-gen';

/**
 * @hidden
 */
export interface ToolbarConf {
    items: (IFlyoutSpec | ISeparatorSpec | IUnknownCommandSpec | ICommandSpec)[];
}

/**
 * @hidden
 */
export interface PreparedSubMenuSet {
    toolbars: Dictionary<ToolbarConf>;
    flyouts: Dictionary<IFlyoutSpec>;
}

/**
 * @hidden
 */
export function isFlyoutSpec(item: any): item is IFlyoutSpec {
    return typeof(item.children) != 'undefined';
}

/**
 * @hidden
 */
export interface IFlyoutSpec {
    label?: string;
    tooltip?: string;
    icon?: string;
    spriteClass?: string;
    children: (IFlyoutSpec | ISeparatorSpec | IUnknownCommandSpec | ICommandSpec)[];
}

/**
 * @hidden
 */
export interface ISeparatorSpec {
    isSeparator: boolean;
}

/**
 * @hidden
 */
export interface IUnknownCommandSpec {
    error: string;
}

/**
 * @hidden
 */
export interface ICommandSpec {
    icon: string;
    spriteClass: string;
    label: string | null;
    tooltip: string;
    parameters: any;
    command?: string;
    componentName?: string;
    flyoutId?: string;
}

/**
 * @hidden
 */
export function convertWidget(widget: UIWidget, locale: string, noToolbarLabels: boolean): ICommandSpec | IUnknownCommandSpec {
    switch (widget.Type) {
        case "Select":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Select, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "WmsQuery":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.WmsQuery, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "Pan":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Pan, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        //case "PanQuery":
        //case "PanOnClick":
        case "Zoom":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Zoom, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "ZoomOnClick": //Covers in and out. Look at Factor parameter
            {
                const factor = parseFloat(widget.Extension.Factor);
                if (factor >= 1.0) {
                    return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.ZoomIn, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
                } else {
                    return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.ZoomOut, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
                }
            }
        case "InitialMapView":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.ZoomExtents, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "ZoomToSelection":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.ZoomToSelection, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "ExtentHistory": //Covers prev and next. Look at Direction parameter
            {
                if (widget.Extension.Direction == "previous") {
                    return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.PreviousView, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
                } else {
                    return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.NextView, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
                }
            }
        case "CenterSelection":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.CenterSelection, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "About":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.About, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "BufferPanel":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Buffer, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "ClearSelection":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.ClearSelection, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        //case "ColorPicker":
        case "CoordinateTracker":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.CoordinateTracker, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "FeatureInfo":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.FeatureInfo, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "Geolocation":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Geolocation, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        //case "GoogleStreetViewer":
        case "Help":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Help, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "Maptip":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.MapTip, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "MapMenu":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, componentName: DefaultComponentNames.MapMenu, flyoutId: `${DefaultComponentNames.MapMenu}_${generateId()}`, parameters: widget.Extension };
        case "Query":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Query, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "QuickPlot":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.QuickPlot, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "Redline":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Redline, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "RefreshMap":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.RefreshMap, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        //case "SaveMap":
        case "InvokeURL": //Commands with this name would've been registered beforehand
        case "Search":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: widget.Name, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "SelectPolygon":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.SelectPolygon, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "SelectRadius":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.SelectRadius, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        //case "SelectRadiusValue":
        case "SelectWithin":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.SelectWithin, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "Theme":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Theme, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "ViewOptions":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.ViewerOptions, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "ZoomToSelection":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.ZoomToSelection, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "Measure":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: DefaultCommands.Measure, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        case "BasemapSwitcher":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, componentName: DefaultComponentNames.BaseMapSwitcher, flyoutId: `${DefaultComponentNames.BaseMapSwitcher}_${generateId()}`, parameters: widget.Extension };
        case "InvokeScript":
            return { icon: widget.ImageUrl, spriteClass: widget.ImageClass, command: widget.Name, label: (noToolbarLabels ? null : widget.Label), tooltip: widget.Tooltip, parameters: widget.Extension };
        default:
            return { error: tr("UNKNOWN_WIDGET", locale, { widget: widget.Type }) }
    }
}