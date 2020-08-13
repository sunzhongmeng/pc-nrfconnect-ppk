/* Copyright (c) 2015 - 2018, Nordic Semiconductor ASA
 *
 * All rights reserved.
 *
 * Use in source and binary forms, redistribution in binary form only, with
 * or without modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions in binary form, except as embedded into a Nordic
 *    Semiconductor ASA integrated circuit in a product or a software update for
 *    such product, must reproduce the above copyright notice, this list of
 *    conditions and the following disclaimer in the documentation and/or other
 *    materials provided with the distribution.
 *
 * 2. Neither the name of Nordic Semiconductor ASA nor the names of its
 *    contributors may be used to endorse or promote products derived from this
 *    software without specific prior written permission.
 *
 * 3. This software, with or without modification, must only be used with a Nordic
 *    Semiconductor ASA integrated circuit.
 *
 * 4. Any software provided in binary form under this license must not be reverse
 *    engineered, decompiled, modified and/or disassembled.
 *
 * THIS SOFTWARE IS PROVIDED BY NORDIC SEMICONDUCTOR ASA "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY, NONINFRINGEMENT, AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL NORDIC SEMICONDUCTOR ASA OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
 * TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/* eslint no-bitwise: off */
/* eslint no-plusplus: off */
/* eslint operator-assignment: off */

import React, {
    useState, useRef, useEffect, useCallback,
} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Line } from 'react-chartjs-2';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import { unit } from 'mathjs';

import annotationPlugin from 'chartjs-plugin-annotation';
import dragSelectPlugin from '../utils/chart.dragSelect';
import zoomPanPlugin from '../utils/chart.zoomPan';
import crossHairPlugin from '../utils/chart.crossHair';

import {
    chartWindowAction,
    chartCursorAction,
    chartState,
} from '../reducers/chartReducer';

import { exportChart } from '../actions/fileActions';

import { options, timestampToIndex } from '../globals';
import BufferView from './BufferView';

import colors from './colors.scss';

const dataColor = colors.accent;
const valueRange = { min: 0, max: 15000 };
const bitColors = [
    colors.red,
    colors.indigo,
    colors.amber,
    colors.purple,
    colors.green,
    colors.deepPurple,
    colors.orange,
    colors.lime,
    colors.pink,
];
const bitLabels = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'];

const timestampToLabel = (usecs, index, array) => {
    const microseconds = Math.abs(usecs);
    const sign = usecs < 0 ? '-' : '';
    if (!array) {
        return `${sign}${Number((microseconds / 1e3)).toFixed(3)} ms`;
    }
    if (index > 0 && index < array.length - 1) {
        const first = array[0];
        const last = array[array.length - 1];
        const range = last - first;
        if ((usecs - first < range / 8) || (last - usecs < range / 8)) {
            return undefined;
        }
    }

    const d = new Date(microseconds / 1e3);
    const h = d.getUTCHours().toString().padStart(2, '0');
    const m = d.getUTCMinutes().toString().padStart(2, '0');
    const s = d.getUTCSeconds().toString().padStart(2, '0');

    const time = `${sign}${h}:${m}:${s}`;
    const subsecond = `${Number((microseconds / 1e3) % 1e3).toFixed(3)}`.padStart(7, '0');

    return [time, subsecond];
};

const formatCurrent = uA => unit(uA, 'uA')
    .format({ notation: 'fixed', precision: 3 })
    .replace('u', '\u00B5');

crossHairPlugin.formatY = formatCurrent;
crossHairPlugin.formatX = timestampToLabel;

const allOfBits = 8;

const emptyArray = () => [...Array(4000)].map(() => ({ x: undefined, y: undefined }));
const lineData = emptyArray();
const bitsData = [...Array(allOfBits)].map(() => emptyArray());
const bitIndexes = new Array(allOfBits);
const lastBits = new Array(allOfBits);

const Chart = () => {
    const dispatch = useDispatch();
    const chartWindow = useCallback((windowBegin, windowEnd, yMin, yMax) => dispatch(
        chartWindowAction(
            windowBegin, windowEnd, windowEnd - windowBegin, yMin, yMax,
        ),
    ), [dispatch]);
    const chartReset = useCallback(windowDuration => dispatch(
        chartWindowAction(null, null, windowDuration, undefined, undefined),
    ), [dispatch]);
    const chartCursor = useCallback((cursorBegin, cursorEnd) => dispatch(
        chartCursorAction(cursorBegin, cursorEnd),
    ), [dispatch]);
    const {
        windowBegin,
        windowEnd,
        windowDuration,
        samplingRunning,
        canReset,
        cursorBegin,
        cursorEnd,
        yMin,
        yMax,
        index,
    } = useSelector(chartState);

    const chartRef = useRef(null);

    const { data, bits } = options;

    let numberOfBits = (windowDuration <= 4500000) ? allOfBits : 0;
    if (!bits) {
        numberOfBits = 0;
    }

    const end = windowEnd || options.timestamp - options.samplingTime;
    const begin = windowBegin || (end - windowDuration);

    const [from, to] = (cursorBegin === null) ? [begin, end] : [cursorBegin, cursorEnd];
    const [len, setLen] = useState(0);

    const onChartSizeUpdate = instance => {
        const { left, right } = instance.chart.chartArea;
        const width = Math.trunc(right - left);
        setLen(Math.min(width, 2000));
    };

    const calcIndexBegin = Math.ceil(timestampToIndex(from, index));
    const calcIndexEnd = Math.floor(timestampToIndex(to, index));

    let calcSum = 0;
    let calcLen = 0;
    let calcMax;

    for (let n = calcIndexBegin; n <= calcIndexEnd; ++n) {
        const k = (n + data.length) % data.length;
        const v = data[k];
        if (!Number.isNaN(v)) {
            if (calcMax === undefined || v > calcMax) {
                calcMax = v;
            }
            calcSum = calcSum + v;
            ++calcLen;
        }
    }

    const calcDelta = to - from;
    const calcAvg = calcSum / (calcLen || 1);

    const zoomPanCallback = useCallback((beginX, endX, beginY, endY) => {
        if (typeof beginX === 'undefined') {
            chartReset(windowDuration);
            return;
        }

        const earliestDataTime = options.timestamp
            - ((data.length / options.samplesPerSecond) * 1e6);

        chartWindow(
            Math.max(earliestDataTime, beginX),
            Math.min(options.timestamp, endX), beginY, endY,
        );
    }, [chartReset, chartWindow, data.length, windowDuration]);

    useEffect(() => {
        if (!chartRef.current.chartInstance) {
            return;
        }

        const { dragSelect, zoomPan } = chartRef.current.chartInstance;
        onChartSizeUpdate(chartRef.current.chartInstance);
        dragSelect.callback = chartCursor;
        zoomPan.callback = zoomPanCallback;
    }, [chartCursor, zoomPanCallback]);

    const chartResetToLive = () => zoomPanCallback(undefined, undefined);
    const resetCursor = () => chartCursor(null, null);
    const chartPause = () => chartWindow(
        options.timestamp - windowDuration, options.timestamp,
    );

    const originalIndexBegin = timestampToIndex(begin, index);
    const originalIndexEnd = timestampToIndex(end, index);
    const step = (originalIndexEnd - originalIndexBegin) / len;

    let mappedIndex = 0;
    bitIndexes.fill(0);

    for (let i = 0; i < numberOfBits; ++i) {
        bitsData[i][0] = { x: undefined, y: undefined };
    }
    if (step > 1) {
        for (let originalIndex = originalIndexBegin;
            mappedIndex < len + len;
            ++mappedIndex, originalIndex = originalIndex + step) {
            const timestamp = begin + (windowDuration * (mappedIndex / (len + len)));
            const k = Math.floor(originalIndex);
            const l = Math.floor(originalIndex + step);
            let min = Number.MAX_VALUE;
            let max = -Number.MAX_VALUE;
            for (let n = k; n < l; ++n) {
                const v = data[(n + data.length) % data.length];
                if (!Number.isNaN(v)) {
                    if (v > max) max = v;
                    if (v < min) min = v;
                }
            }

            if (min > max) {
                min = undefined;
                max = undefined;
            }
            lineData[mappedIndex].x = timestamp;
            lineData[mappedIndex].y = min;
            ++mappedIndex;
            lineData[mappedIndex].x = timestamp;
            lineData[mappedIndex].y = max;

            for (let i = 0; i < numberOfBits; ++i) {
                let y1;
                for (let n = k; n < l; ++n) {
                    const ni = (n + data.length) % data.length;
                    if (!Number.isNaN(data[ni])) {
                        const v = (((bits[ni] >> i) & 1) - 0.5) * 0.8;
                        if (y1 === undefined || v !== y1) {
                            if ((bitsData[i][bitIndexes[i] - 1] || {}).y !== v
                                || mappedIndex === len + len - 1) {
                                bitsData[i][bitIndexes[i]].x = timestamp;
                                bitsData[i][bitIndexes[i]].y = v;
                                ++bitIndexes[i];
                            }
                            if (y1 !== undefined) {
                                break;
                            }
                            y1 = v;
                        }
                    }
                }
            }
        }
    } else {
        lastBits.fill(undefined);
        let last;
        const originalIndexBeginFloored = Math.floor(originalIndexBegin);
        const originalIndexEndCeiled = Math.ceil(originalIndexEnd);
        for (let n = originalIndexBeginFloored; n <= originalIndexEndCeiled; ++mappedIndex, ++n) {
            const k = (n + data.length) % data.length;
            const v = data[k];
            const timestamp = begin + (((n - originalIndexBegin) * 1e6) / options.samplesPerSecond);
            lineData[mappedIndex].x = timestamp;
            if (n < originalIndexEndCeiled) {
                last = Number.isNaN(v) ? undefined : v;
            }
            lineData[mappedIndex].y = last;

            for (let i = 0; i < numberOfBits; ++i) {
                const y = Number.isNaN(v) ? undefined : (((bits[k] >> i) & 1) - 0.5) * 0.8;
                bitsData[i][bitIndexes[i]].x = timestamp;
                if (n === originalIndexEndCeiled) {
                    bitsData[i][bitIndexes[i]].y = lastBits[i];
                    ++bitIndexes[i];
                } else if ((bitsData[i][bitIndexes[i] - 1] || {}).y !== y) {
                    bitsData[i][bitIndexes[i]].y = y;
                    lastBits[i] = y;
                    ++bitIndexes[i];
                }
            }
        }
    }

    const live = (windowBegin === 0) && (windowEnd === 0);
    const chartCursorActive = ((cursorBegin !== null) || (cursorEnd !== null));

    const bitsDataSets = bitsData.slice(0, numberOfBits).map((b, i) => ({
        borderColor: bitColors[i],
        backgroundColor: `${bitColors[i]}0f`,
        borderWidth: 0.5,
        fill: 'origin',
        data: b.slice(0, bitIndexes[i]),
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        pointBorderWidth: 0,
        lineTension: 0,
        label: bitLabels[i],
        yAxisID: `bits-axis-${i}`,
        steppedLine: 'before',
    }));

    const bitsAxis = bitsData.slice(0, numberOfBits).map((_, i) => ({
        id: `bits-axis-${i}`,
        type: 'linear',
        position: 'right',
        ticks: {
            fontColor: bitColors[i],
            autoSkip: false,
            min: -i - 0.5,
            max: 7.5 - i,
            labelOffset: -10,
            minRotation: 90,
            maxRotation: 90,
            callback: (n => ((n === 0) ? bitLabels[i] : '')),
            mirror: true,
            padding: 10,
        },
        gridLines: {
            display: false,
            drawTicks: false,
        },
    }));

    const chartData = {
        datasets: [{
            borderColor: dataColor,
            borderWidth: 1,
            fill: false,
            data: lineData.slice(0, mappedIndex),
            pointRadius: step > 0.2 ? 0 : 1.5,
            pointHoverRadius: step > 0.2 ? 0 : 3,
            pointHitRadius: step > 0.2 ? 0 : 3,
            pointBackgroundColor: dataColor,
            pointHoverBackgroundColor: dataColor,
            pointBorderWidth: 0,
            pointHoverBorderWidth: 0,
            lineTension: step > 0.2 ? 0 : 0.2,
            label: 'Current',
            yAxisID: 'yScale',
            labelCallback: ({ y }) => formatCurrent(y),
        }, ...bitsDataSets],
    };

    const chartOptions = {
        scales: {
            xAxes: [{
                id: 'xScale',
                type: 'linear',
                min: begin,
                max: end,
                ticks: {
                    minRotation: 0,
                    maxRotation: 0,
                    autoSkipPadding: 25,
                    min: begin,
                    max: end,
                    callback: timestampToLabel,
                    maxTicksLimit: 7,
                },
                gridLines: {
                    display: true,
                    drawBorder: true,
                    drawOnChartArea: false,
                },
                cursor: {
                    cursorBegin,
                    cursorEnd,
                },
            }],
            yAxes: [{
                id: 'yScale',
                type: 'linear',
                ...valueRange,
                ticks: {
                    minRotation: 0,
                    maxRotation: 0,
                    suggestedMin: valueRange.min,
                    suggestedMax: valueRange.max,
                    min: yMin === null ? valueRange.min : yMin,
                    max: yMax === null ? undefined : yMax,
                    maxTicksLimit: 7,
                    padding: 0,
                    callback: formatCurrent,
                },
                gridLines: {
                    display: true,
                    drawBorder: true,
                    drawOnChartArea: true,
                    borderDash: [3, 6],
                },
                afterFit: scale => { scale.width = 80; }, // eslint-disable-line
            }, ...bitsAxis],
        },
        redraw: true,
        maintainAspectRatio: false,
        onResize: onChartSizeUpdate,
        animation: {
            duration: 0,
        },
        hover: {
            animationDuration: 0,
        },
        responsiveAnimationDuration: 0,
        annotation: options.triggerMarkers ? {
            drawTime: 'beforeDatasetsDraw',
            annotations: options.triggerMarkers
                .reduce((pairs, _, i, array) => {
                    if (!(i % 2)) {
                        pairs.push(array.slice(i, i + 2));
                    }
                    return pairs;
                }, [])
                .map(([m1, m2]) => ({
                    type: 'box',
                    xScaleID: 'xScale',
                    xMin: m1 - options.samplingTime,
                    xMax: m2 - options.samplingTime,
                    backgroundColor: 'rgba(0, 100, 255, 10%)',
                    borderColor: 'rgba(0, 0, 0, 0)',
                    borderWidth: 0,
                })),
        } : undefined,
        tooltips: {
            enabled: true,
            mode: 'point',
            intersect: false,
            callbacks: {
                title: items => timestampToLabel(items[0].xLabel),
                label: (item, d) => {
                    const dataset = d.datasets[item.datasetIndex];
                    const element = dataset.data[item.index];
                    if (dataset.labelCallback) {
                        return dataset.labelCallback(element);
                    }
                    return `${dataset.label}: ${element.y}`;
                },
            },
        },
        legend: {
            display: true,
        },
    };

    const renderValue = (label, u) => {
        const v = u.format({ notation: 'fixed', precision: 3 });
        const [valStr, unitStr] = v.split(' ');
        return <span>{label}: <b>{valStr}</b> {unitStr.replace('u', '\u00B5')}</span>;
    };

    let marked = unit(calcDelta, 'us');
    if (calcDelta > 60 * 1e6) {
        marked = marked.to('min');
    }

    return (
        <div className="chart-outer">
            <div className="chart-top">
                <BufferView />
            </div>
            <div className="chart-container">
                <Line
                    ref={chartRef}
                    data={chartData}
                    options={chartOptions}
                    plugins={[dragSelectPlugin, zoomPanPlugin, annotationPlugin, crossHairPlugin]}
                />
            </div>
            <div className="chart-bottom">
                <div className="chart-stats">
                    {renderValue(`${cursorBegin !== null ? 'marker' : 'window'} \u0394`, marked)}
                    {renderValue('avg', unit(calcAvg, 'uA'))}
                    {renderValue('max', unit(calcMax || 0, 'uA'))}
                    {renderValue('charge', unit(calcAvg * ((calcDelta || 1) / 1e6), 'uC'))}
                </div>
                <ButtonGroup>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => dispatch(exportChart())}
                        title={chartCursorActive ? 'Export marked' : 'Export window'}
                    >
                        <span className="mdi mdi-export" />
                    </Button>
                    <Button
                        variant="primary"
                        disabled={!chartCursorActive}
                        size="sm"
                        onClick={resetCursor}
                        title={chartCursorActive ? 'Clear Marker' : 'Hold shift + click and drag to select an area'}
                    >
                        <span className="mdi mdi-eraser" />
                    </Button>
                    {samplingRunning !== null && (
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={!samplingRunning && live}
                            onClick={live ? chartPause : chartResetToLive}
                            title={live ? 'Pause' : 'Live'}
                        >
                            <span className={`mdi mdi-${live ? 'pause' : 'step-forward'}`} />
                        </Button>
                    )}
                    {samplingRunning === null && (
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={!canReset}
                            onClick={chartResetToLive}
                            title="Reset & Live"
                        >
                            <span className="mdi mdi-repeat" />
                        </Button>
                    )}
                </ButtonGroup>
            </div>
        </div>
    );
};

export default Chart;
