(function() {
  var MS_PER_DAY = 24*60*60*1000;
  var SEARCH_WINDOW = 2 * MS_PER_DAY;
  var startTime = 0;
  var tdata = [];
  var outgoingData = [];
  var requestData = [];

  var $table = $('#logs').dataTable({
    columns: [
      {
        data: 'timestamp'
      },
      {
        data: 'severity',
        defaultContent: 'NONE'
      },
      {
        data: 'logmessage',
        defaultContent: ''
      }
    ]
  });

  $table.on( 'click', 'tr', function () {
    var api = $table.dataTable().api();
    var rowData = api.row(this).data();
    showMessage(rowData);
  });

  var timelineData = new vis.DataSet();
  var timelineDataGroups = new vis.DataSet();
  var timeline = new vis.Timeline(document.getElementById("graph"));

  timeline.on('select', function() {
    var sel = timeline.getSelection();
    var element;
    if (sel && sel.length) {
      element = timelineData.get(sel[0]);
    }
    showMessage(element && element.msg);
  });

  $('#toggleLogType #outgoing').on('click', function () {
    var outgoingState = !$('#toggleLogType #outgoing').hasClass('active');
    var requestState = $('#toggleLogType #request').hasClass('active');

    bindDataToTimeline(outgoingState, requestState);
  });

  $('#toggleLogType #request').on('click', function () {
    var outgoingState = $('#toggleLogType #outgoing').hasClass('active');
    var requestState = !$('#toggleLogType #request').hasClass('active');

    bindDataToTimeline(outgoingState, requestState);
  });

  function request(requestId, server, searchdate) {
    startTime = $.now();
    $("#getlogs").attr('disabled', true);

    var around = Date.parse(searchdate);
    var dates = [];
    for (var d = around - SEARCH_WINDOW; d <= around + SEARCH_WINDOW && d < new Date().getTime(); d += MS_PER_DAY) {
      dates.push("logstash-" + new Date(d).toISOString().substring(0, 10).replace("-",".").replace("-","."));
    }

    $.ajax({
      url: server + dates.join(',') + "/_search",
      contentType: "application/json",
      data: {
        q: '+ot-requestid:"' + requestId + '"',
        sort: "@timestamp:asc",
        size: 10000
      },
      server: server,
      requestId: requestId,
      searchdate: searchdate,
      error: onError,
      success: onSuccess
    });
  }

  function go(event) {
    event.preventDefault();
    request($("#requestid").val(), $("#server").val(), $("#searchdate").val());
  }

  $(document).ready(function() {
    $("#getlogs").closest('form').submit(go);
    $("#getlogs").prop("disabled", false);

    var url = $.url();
    var server = url.param("server");
    var requestId = url.param("requestId");
    var searchdate = url.param("searchdate");

    if (server) {
      var serverSelect = document.getElementById("server");
      $.each(serverSelect.options, function (idx, option) {
        if (option.value == server) {
          serverSelect.selectedIndex = idx;
        }
      });
    }
    if (requestId) {
      $("#requestid").val(requestId);
      $("#getlogs").closest('form').submit();
    }
    if (searchdate) {
      $("#searchdate").val(searchdate);
    } else {
      $("#searchdate").val(new Date().toISOString().substring(0, 10));
    }
  });

  function onError(jqXHR, textStatus, errorThrown) {
    $("#getlogs").attr('disabled', false);
    alert("Error: " + textStatus + " " + errorThrown);
  }

  function onSuccess(data, textStatus, jqXHR) {
    $("#getlogs").attr('disabled', false);
    history.replaceState({}, this.requestId, "?server=" + encodeURIComponent(this.server) + "&requestId=" + encodeURIComponent(this.requestId) + "&searchdate=" + encodeURIComponent(this.searchdate));

    $("#duration").text(data.took + " ms");
    $("#renderduration").text( ($.now() - startTime - data.took) + " ms");

    tdata = [];
    outgoingData = [];
    requestData = [];

    data.hits.hits.forEach(function(doc) {
      var msg = doc['_source'];
      switch (msg.logname) {
      case 'outgoing':
        outgoingData.push(populateTimelineRequest(msg));
        break;
      case 'request':
        requestData.push(populateTimelineRequest(msg));
      default:
        msg.timestamp = msg['@timestamp'];
        tdata.push(msg);
        break;
      }
    });

    bindDataToTimeline(true, false);
  }

  function bindDataToTimeline(bindOutgoing, bindRequest) {
    timelineData.clear();
    timelineDataGroups.clear();

    var numberOfRequests;
    if (bindOutgoing && !bindRequest) {
      numberOfRequests = outgoingData.length;
      timelineData.add(outgoingData);
    } 
    else if (!bindOutgoing && bindRequest) {
      numberOfRequests = requestData.length;
      timelineData.add(requestData);
    }
    else if (bindOutgoing && bindRequest) {
      numberOfRequests = requestData.length + outgoingData.length;
      timelineData.add(outgoingData);
      timelineData.add(requestData);
    }

    $("#nreqs").text(numberOfRequests);

    timelineData.forEach(function(item) {
      if (!timelineDataGroups.get(item.group)) {
        timelineDataGroups.add([{
          id: item.group,
          content: item.group
        }]);
      }
    });
    timeline.setItems(timelineData);
    timeline.setGroups(timelineDataGroups);
    // timeline.fit() animates to fit new data set.
    timeline.fit();

    var api = $table.dataTable().api();
    api.clear();
    api.rows.add(tdata);
    api.draw();
  }

  function populateTimelineRequest(msg) {
    var timelineRequestItem;
    var when = Date.parse(msg['@timestamp']);
    if (when) {
      var title;
      var referrer = msg.servicetype;
      if (referrer) {
        title = referrer + ":" + msg.url;
      } else{
        title = msg.url;
      }
      var cssClass = "httpSuccess" + " " + msg.logname;
      var sc = msg.status;
      if (sc >= 300 && sc < 400) {
        cssClass = "httpRedirect";
      }
      if (sc >= 400 || typeof sc === 'undefined') {
        cssClass = "httpError";
      }
      var duration = msg.duration/1000 || msg.durationms; // hack until we all migrate
      timelineRequestItem = {
        "content": title,
        "group": referrer || "unknown",
        "start": new Date(when - duration),
        "end": new Date(when),
        "msg": msg,
        "className": cssClass
      };
    } 
    else {
      console.log("Refusing " + JSON.stringify(msg));
    }
    return timelineRequestItem;
  }

  var messageTemplate = Hogan.compile("" +
    '{{#object}}' +
    '<span class="jk">"{{key}}"</span><span class="jc">: </span><span class="jv">"{{value}}"</span><br/>' +
    '{{/object}}'
  );

  function showMessage(msg) {
    if (msg) {
      var text = "";
      var messageForRendering = Object.keys(msg).map(function(key) {
        var value = msg[key];
        if (typeof value === "object") {
          value = JSON.stringify(value);
        }
        return {
          key: key,
          value: value
        };
      });
      $('#myModal .modal-body').html(messageTemplate.render({object: messageForRendering}));
      $('#myModal').modal('show');
    }
  }
})();
