function buildObjectFieldsTable(parent, label, object) {
    var table = document.createElement("table");

    var header = document.createElement("tr");
    var labelCell = document.createElement("th");
    labelCell.setAttribute("colspan", 2);
    labelCell.appendChild(document.createTextNode(label));
    header.appendChild(labelCell);
    table.appendChild(header);

    var even = false;
    for (let limit in object) {
        let row = document.createElement("tr");
        
        let limitCell = document.createElement("td");
        limitCell.appendChild(document.createTextNode(limit));
        row.appendChild(limitCell);

        let valueCell = document.createElement("td");
        valueCell.appendChild(document.createTextNode(object[limit]));
        row.appendChild(valueCell);

        table.appendChild(row);
    }

    parent.appendChild(table);
}

function buildSetTable(parent, label, set) {
    var table = document.createElement("table");

    var header = document.createElement("tr");
    var labelCell = document.createElement("th");
    labelCell.appendChild(document.createTextNode(label));
    header.appendChild(labelCell);
    table.appendChild(header);

    for (let feature of set.keys()) {
        let row = document.createElement("tr");
        
        let featureCell = document.createElement("td");
        featureCell.appendChild(document.createTextNode(feature));
        row.appendChild(featureCell);

        table.appendChild(row);
    }

    parent.appendChild(table);
}

(async () => {
    var adapter = await navigator.gpu?.requestAdapter();
    var device = await adapter?.requestDevice({requiredLimits: {maxBindGroups: 4}});

    if (device === undefined) {
        alert("Could not initialize WebGPU");
        return;
    }
    
    let adapterInfo = await adapter.requestAdapterInfo();

    let adapterInfoContainer = document.createElement("div");
    buildObjectFieldsTable(adapterInfoContainer, "Adapter", adapterInfo);
    document.body.appendChild(adapterInfoContainer);

    let limitContainer = document.createElement("div");
    buildObjectFieldsTable(limitContainer, "Limits", adapter.limits);
    document.body.appendChild(limitContainer);

    let featureContainer = document.createElement("div");
    buildSetTable(featureContainer, "Features", adapter.features);
    document.body.appendChild(featureContainer);
})();
