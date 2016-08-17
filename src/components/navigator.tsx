import * as React from "react";

export enum ZoomDirection {
    In,
    Out
}

export enum PanDirection {
    East,
    West,
    South,
    North
}

interface INavigatorProps extends React.Props<any> {
    style?: React.CSSProperties,
    busy: boolean;
    onZoom: (direction: ZoomDirection) => void;
    onPan: (direction: PanDirection) => void;
}

export class Navigator extends React.Component<INavigatorProps, any> {
    fnPanEast: (e) => void;
    fnPanWest: (e) => void;
    fnPanSouth: (e) => void;
    fnPanNorth: (e) => void;
    fnZoomOut: (e) => void;
    fnZoomIn: (e) => void;
    constructor(props) {
        super(props);
        this.fnPanEast = this.onPanEast.bind(this);
        this.fnPanWest = this.onPanWest.bind(this);
        this.fnPanSouth = this.onPanSouth.bind(this);
        this.fnPanNorth = this.onPanNorth.bind(this);
        this.fnZoomOut = this.onZoomOut.bind(this);
        this.fnZoomIn = this.onZoomIn.bind(this);
    }
    private onPanEast(e) {
        this.props.onPan(PanDirection.East);
    }
    private onPanWest(e) {
        this.props.onPan(PanDirection.West);
    }
    private onPanSouth(e) {
        this.props.onPan(PanDirection.South);
    }
    private onPanNorth(e) {
        this.props.onPan(PanDirection.North);
    }
    private onZoomOut(e) {
        this.props.onZoom(ZoomDirection.Out);
    }
    private onZoomIn(e) {
        this.props.onZoom(ZoomDirection.In);
    }
    render(): JSX.Element {
        const { busy } = this.props;
        return <div id="Navigator" style={this.props.style} className="noselect">
            <map name="Navigator_ImageMap" id="Navigator_ImageMap">
                <area onClick={this.fnPanEast} shape="poly" alt="Pan East" title="Pan East" coords="27,176, 27,177, 40,190, 44,182, 44,159" />
                <area onClick={this.fnPanWest} shape="poly" alt="Pan West" title="Pan West" coords="24,177, 24,176, 7,159, 7,182, 11,190" />
                <area onClick={this.fnPanSouth} shape="poly" alt="Pan South" title="Pan South" coords="25,178, 12,191, 21,197, 30,197, 39,191, 26,178" />
                <area onClick={this.fnPanNorth} shape="poly" alt="Pan North" title="Pan North" coords="26,175, 43,158, 8,158, 25,175" />
                <area onClick={this.fnZoomOut} shape="circle" alt="Zoom Out" title="Zoom Out" coords="25,142,8" />
                <area onClick={this.fnZoomIn} shape="circle" alt="Zoom In" title="Zoom In" coords="25,34,8" />
            </map>
            <img src="stdicons/sliderscale.png" className="png24" width="51" height="201" useMap="#Navigator_ImageMap" style={{ position: "absolute", left: 0, top: 0 }} />
            <div style={{ position: "absolute", top: 6, left: 6, width: 39, height: 16 }}>
                <img src="stdicons/spinner.gif" width="18" height="6" style={{ position: "absolute", top: 3, right: 4, visibility: busy ? "visible" : "hidden" }} />
            </div>
            <div style={{ position: "absolute", top: 44, left: 0, width: 51, height: 85 }}>
                <img src="stdicons/slider.png" className="png24" width="29" height="12" style={{ position: "relative", left: 11, top: 28 }} />
            </div>
        </div>;
    }
}