"use strict"

class MemoryMap {

    constructor (originalData, {topKey="data", autoUpdate=true, depth=5, google=window.google, container=document.body, chartConfig, calculateDeltas}={}) {

        const self = this
        this.startingValues = {}

        this.proxyHandler = {
            get (target, key, value) {
                return target[key]
            },
            set (target, key, value) {
                if (self.proxyActive && (Array.isArray(value) || value instanceof Object)) {
                    value = self.makeProxy(value)
                }

                target[key] = value

                if (self.proxyActive && self.autoUpdate) {
                    self.computeSizes()
                    self.convertToGoogleFormat()
                    self.renderChart()
                }

                return true
            },
            deleteProperty (target, key, value) {
                delete target[key]

                if (self.proxyActive && self.autoUpdate) {
                    self.computeSizes()
                    self.convertToGoogleFormat()
                    self.renderChart()
                }
                return true
            },
            apply (target, key, value) {
                return key[target].apply(self, value)
            }
        }

        this.proxyActive = false
        this.proxy = this.makeProxy(originalData)

        this.topKey = topKey
        this.autoUpdate = autoUpdate
        this.google = google
        this.container = container
        this.google.charts.load("current", {packages: ["treemap"]})
        this.google.charts.setOnLoadCallback(() => {
            this.chart = new this.google.visualization.TreeMap(this.container)

            self.computeSizes()
            this.proxyActive = false
            self.convertToGoogleFormat()
            self.renderChart()
            this.proxyActive = true
        })
        this.calculateDeltas = calculateDeltas

        this.chartConfig = chartConfig || {
            highlightOnMouseOver: true,
            useWeightedAverageForAggregation: true,

            maxDepth: depth,
            maxPostDepth: depth,
            minColor: "#f00",
            midColor: "#ddd",
            maxColor: "#0d0",
            headerHeight: 15,
            fontColor: "black",
        }

        this.chartConfig.generateTooltip = this.chartConfig.generateTooltip || ((row, size, value) => {

            let label = `${(size/1073741824).toFixed(3)} GiB`

            // Credit: https://gist.github.com/zensh/4975495
            switch (true) {
                case size < 1024:
                    label = `${size} bytes`
                    break
                case size < 1048576:
                    label = `${(size/1024).toFixed(3)} KiB`
                    break
                case size < 1073741824:
                    label = `${(size/1048576).toFixed(3)} MiB`
                    break
            }
            return `<div style="font-family:Helvetica;background:white;padding:5px;border:2px solid black;">${label}</div>`
        })
    }

    makeProxy (data) {

        if (Array.isArray(data)) {

            const proxy = new Proxy([], this.proxyHandler)

            for (let i=0; i<data.length; i++) {
                let value = data[i]
                proxy[i] = Array.isArray(value) || value instanceof Object ? this.makeProxy(value) : value
            }

            return proxy

        } else if (data instanceof Object) {

            const proxy = new Proxy({}, this.proxyHandler)
            data.__MemoryMapHasVisited = true

            Object.keys(data)
            .filter(key => !data[key].__MemoryMapHasVisited)
            .forEach(key => {
                // console.log(data, key)
                proxy[key] = Array.isArray(data[key]) || data[key] instanceof Object ? this.makeProxy(data[key]) : data[key]
            })

            return proxy

        } else {
            return data
        }
    }

    computeSizes () {
        this.proxyActive = false
        this.sizesObject = this.buildSizes(this.proxy)
        this.proxyActive = true
    }

    buildSizes (data) {

        if (data===null || data===undefined) return {value: data, size: 0}

        if (Array.isArray(data)) {

            const item = []
            let itemSize = 0

            for (let i=0; i<data.length; i++) {

                let size = 0
                let value = data[i]

                if (value!==null && value!==undefined) {
                    item[i] = this.buildSizes(data[i])
                    itemSize += item[i].size
                }
            }
            return {value: item, size: itemSize}

        } else if (data instanceof Object) {

            const item = {}
            let itemSize = 0

            Object.keys(data)
            .filter(key => key != "__MemoryMapHasVisited")
            .forEach(key => {
                // console.log(data, key, data[key])
                let size = 0
                let value = data[key]

                if (value!==null && value!==undefined) {
                    item[key] = this.buildSizes(data[key])
                    itemSize += item[key].size
                }
            })
            return {value: item, size: itemSize}

        } else {
            return {value: data, size: this.sizeOf(data)}
        }
    }

    // Credit: https://gist.github.com/zensh/4975495
    sizeOf (obj, bytes=0) {
        if (obj !== null && obj !== undefined) {
            switch (typeof obj) {
                case "number":
                    bytes += 8
                    break
                case "string":
                    bytes += obj.length * 2
                    break
                case "boolean":
                    bytes += 4
                    break
                case "object":
                    const objClass = obj.toString().slice(8, -1)

                    if (objClass === "Object" || objClass === "Array") {
                        for (const key in obj) {
                            if (!obj.hasOwnProperty(key)) continue
                            this.sizeOf(obj[key])
                        }
                    } else {
                        bytes == obj.toString().length * 2
                    }
                    break
            }
        }
        return bytes
    }

    convertToGoogleFormat (deltas) {
        this.chartData = [
            ["Data", "Parent", "Size", "Delta"],
            ...this.convertLevelToGoogleFormat(this.sizesObject, this.topKey, "")
        ]
    }

    convertLevelToGoogleFormat (data, thisKey, parentKey) {
        let rows = []
        const dataRow = []

        dataRow.push(parentKey+thisKey)
        dataRow.push(parentKey)
        dataRow.push(data.size)

        if (this.calculateDeltas) {
            if (this.startingValues[parentKey+thisKey]!==undefined) {
                const original = this.startingValues[parentKey+thisKey]
                const delta = data.size - original
                dataRow.push(delta)
            } else {
                this.startingValues[parentKey+thisKey] = this.proxyActive ? 0 : data.size
                // dataRow.push(this.proxyActive ? 0 : data.size)
                dataRow.push(0)
            }

        } else {
            dataRow.push(0)
        }


        rows.push(dataRow)

        if (Array.isArray(data.value)) {
            data.value.forEach((value, vi) => {
                if (value !== undefined && (Array.isArray(value) || value instanceof Object)) {
                    const resultRows = this.convertLevelToGoogleFormat(value, `[${vi}]`, parentKey+thisKey)
                    rows = [...rows, ...resultRows]
                }
            })
        } else if (data.value instanceof Object) {
            Object.keys(data.value).forEach(key => {
                if (key !== "size") {
                    const resultRows = this.convertLevelToGoogleFormat(data.value[key], `.${key}`, parentKey+thisKey)
                    rows = [...rows, ...resultRows]
                }
            })
        }

        return rows
    }

    renderChart () {
        this.chart.draw(this.google.visualization.arrayToDataTable(this.chartData), this.chartConfig)
    }

    update () {
        this.computeSizes()
        this.convertToGoogleFormat()
        this.renderChart()
    }
}