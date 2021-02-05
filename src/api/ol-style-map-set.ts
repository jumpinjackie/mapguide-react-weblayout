import { DEFAULT_STYLE_KEY, isClusteredFeature } from './ol-style-helpers';
import { ExprEvalContext } from './expr-eval-context';
import Feature from 'ol/Feature';
import Geometry from 'ol/geom/Geometry';
import { DynamicStyleMap, IOlStyleMap, IVectorLayerStyle, IVectorFeatureStyle, DEFAULT_POINT_CIRCLE_STYLE, DEFAULT_LINE_STYLE, DEFAULT_POLY_STYLE, IBasicStroke, isEvaluatable, IBasicFill, IVectorLabelSettings, IBasicVectorPointStyle, IBasicVectorLineStyle, IBasicVectorPolygonStyle, IClusterSettings, ClusterClickAction } from './ol-style-contracts';
import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import { buildFill, buildStroke, tryBuildTextStyle, evalFeature } from './ol-style-builders';
import IconStyle from "ol/style/Icon";
import * as shortid from "shortid";
import { deg2rad } from '../utils/number';

function isDynamicStroke(stroke: IBasicStroke | undefined): boolean {
    if (!stroke) {
        return false;
    }
    return isEvaluatable(stroke.alpha)
        || isEvaluatable(stroke.color)
        || isEvaluatable(stroke.width);
}

function isDynamicFill(fill: IBasicFill | undefined): boolean {
    if (!fill) {
        return false;
    }
    return isEvaluatable(fill.alpha)
        || isEvaluatable(fill.color);
}

function isDynamicLabel(labelSettings: IVectorLabelSettings): boolean {
    const { label } = labelSettings;
    if (!label) {
        return false;
    }
    return isDynamicFill(label.backgroundFill)
        || isDynamicStroke(label.backgroundStroke)
        || isDynamicFill(label.fill)
        || isEvaluatable(label.font)
        || isEvaluatable(label.maxAngle)
        || isEvaluatable(label.offsetX)
        || isEvaluatable(label.offsetY)
        || isEvaluatable(label.overflow)
        || isEvaluatable(label.padding)
        || isEvaluatable(label.placement)
        || isEvaluatable(label.rotateWithView)
        || isEvaluatable(label.rotation)
        || isEvaluatable(label.scale)
        || isDynamicStroke(label.stroke)
        || isEvaluatable(label.text)
        || isEvaluatable(label.textAlign)
        || isEvaluatable(label.textBaseline);
}

function isDynamicPointStyle(style: IBasicVectorPointStyle): boolean {
    const apts: any = style;
    const isBaseDynamic = isEvaluatable(apts.radius)
        || isDynamicFill(apts.fill)
        || isDynamicStroke(apts.stroke);
    if (isBaseDynamic) {
        return true;
    }
    return isDynamicLabel(style);
}

function isDynamicLineStyle(style: IBasicVectorLineStyle): boolean {
    return isDynamicStroke(style)
        || isDynamicLabel(style);
}

function isDynamicPolygonStyle(style: IBasicVectorPolygonStyle): boolean {
    return isDynamicStroke(style.stroke)
        || isDynamicFill(style.fill)
        || isDynamicLabel(style);
}

function buildStyleMap(pts: Style, lns: Style, pls: Style) {
    //For GeometryCollection, combine point and polygon styles
    const cpts = pts.clone();
    const cpls = pls.clone();
    const gcs = new Style({
        image: cpts.getImage(),
        stroke: cpls.getStroke(),
        fill: cpls.getFill()
    });
    return {
        id: shortid.generate(),
        Point: pts,
        MultiPoint: pts,
        LineString: lns,
        MultiLineString: lns,
        Polygon: pls,
        MultiPolygon: pls,
        Circle: pls,
        GeometryCollection: gcs
    };
}

function vectorStyleToStyleMap(style: IVectorFeatureStyle): IOlStyleMap | DynamicStyleMap {
    const ptStyle = style.point ?? DEFAULT_POINT_CIRCLE_STYLE;
    const lnStyle = style.line ?? DEFAULT_LINE_STYLE;
    const plStyle = style.polygon ?? DEFAULT_POLY_STYLE;

    const builder: DynamicStyleMap = (feat, context) => {
        const pts = new Style();
        if (ptStyle.type == "Circle") {
            pts.setImage(new CircleStyle({
                radius: evalFeature(ptStyle.radius, feat, context),
                fill: buildFill(ptStyle.fill, feat, context),
                stroke: buildStroke(ptStyle.stroke, feat, context)
            }));
        } else {
            pts.setImage(new IconStyle({
                anchor: ptStyle.anchor,
                src: evalFeature(ptStyle.src, feat, context),
                rotateWithView: evalFeature(ptStyle.rotateWithView, feat, context),
                rotation: deg2rad(evalFeature(ptStyle.rotation, feat, context)),
                scale: evalFeature(ptStyle.scale, feat, context)
            }));
        }
        const lns = new Style({
            stroke: buildStroke(lnStyle, feat, context)
        });
        const pls = new Style({
            stroke: buildStroke(plStyle.stroke, feat, context),
            fill: buildFill(plStyle.fill, feat, context)
        });

        const ptText = tryBuildTextStyle(ptStyle, feat, context);
        const lnText = tryBuildTextStyle(lnStyle, feat, context);
        const plsText = tryBuildTextStyle(plStyle, feat, context);
        if (ptText) {
            pts.setText(ptText);
        }
        if (lnText) {
            lns.setText(lnText);
        }
        if (plsText) {
            pls.setText(plsText);
        }
        return buildStyleMap(pts, lns, pls);
    }

    const isDynamic = isDynamicPointStyle(ptStyle)
        || isDynamicLineStyle(lnStyle)
        || isDynamicPolygonStyle(plStyle);

    if (isDynamic) {
        return builder;
    } else {
        return builder(undefined, undefined);
    }
}

/**
 * @since 0.14
 */
export class OLStyleMapSet {
    private rules: {
        [filter: string]: IOlStyleMap | DynamicStyleMap;
        default: IOlStyleMap | DynamicStyleMap;
    };
    private clusterRules: {
        [filter: string]: IOlStyleMap | DynamicStyleMap;
        default: IOlStyleMap | DynamicStyleMap;
    } | undefined;
    private exprContext: ExprEvalContext;
    private defaultStyleMap: IOlStyleMap | DynamicStyleMap;
    constructor(private readonly origStyleDef: IVectorLayerStyle, private readonly clusterStyleDef: IClusterSettings | undefined) {
        this.rules = {
            default: vectorStyleToStyleMap(origStyleDef.default)
        };
        this.exprContext = new ExprEvalContext();
        for (const k in origStyleDef) {
            if (k != DEFAULT_STYLE_KEY && origStyleDef[k]) {
                this.rules[k] = vectorStyleToStyleMap(origStyleDef[k]);
            }
            if (k != DEFAULT_STYLE_KEY) {
                this.exprContext.addFilter(k);
            }
        }
        if (clusterStyleDef?.style) {
            const { style } = clusterStyleDef;
            this.clusterRules = {
                default: vectorStyleToStyleMap(style.default)
            };
            for (const k in style) {
                if (k != DEFAULT_STYLE_KEY && style[k]) {
                    this.clusterRules[k] = vectorStyleToStyleMap(style[k]);
                }
                if (k != DEFAULT_STYLE_KEY) {
                    this.exprContext.addClusterFilter(k);
                }
            }
        }
        this.defaultStyleMap = vectorStyleToStyleMap({});
    }
    public toVectorLayerStyle(): IVectorLayerStyle {
        return this.origStyleDef;
    }
    public toClusterSettings(): IClusterSettings | undefined {
        return this.clusterStyleDef;
    }
    public getClusterClickAction(): ClusterClickAction | undefined {
        return this.clusterStyleDef?.onClick;
    }
    public evaluateStyle(feature: Feature<Geometry>) {
        try {
            const g = feature.getGeometry();
            if (!g) {
                return null;
            }
            const gt: any = g.getType();
            const filter = this.exprContext.evaluateFilter(feature);
            let matchingStyle: IOlStyleMap | DynamicStyleMap;
            const r = isClusteredFeature(feature) ? this.clusterRules : this.rules;
            if (filter) {
                matchingStyle = r?.[filter] ?? this.defaultStyleMap;
            } else {
                //Fallback to default
                matchingStyle = r?.default ?? this.defaultStyleMap;
            }
            if (typeof (matchingStyle) == 'function') {
                const esm = matchingStyle(feature, this.exprContext);
                return (esm as any)[gt];
            } else {
                return (matchingStyle as any)[gt];
            }
        } catch (e) {
            console.error(e);
            return null;
        }
    }
}