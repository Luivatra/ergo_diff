/***********************************************************
    ERGO difficulty monitor
    (c) Marko Oette (www.oette.info)
    This code can freely be used. Please credit the author.
***********************************************************/

const epochSize = 128;
const desiredBlockTime = 120;       //seconds

const PrecisionConstant = 1000000000

var currentDifficulty = 0;
var averageTTF = 0;
var currentBlock = 0;
var nextEpochStart = 0;
var remainingTimeThisEpoch = 0;
var remainingBlocksThisEpoch = 0;

var estimatedDifficulty = 0;
var desiredDifficulty = 0;
var estimatedDifficultyUnit = "GH";
var last64BlocksTTF = 0;
var lastEpochTTF = 0;

var blockTimeChart = null;
var blockTimeChartType = 0;     // 0=last two epochs, 1=history

/** Update the website data from ERGO explorer server.
    Writes to currentDifficulty, averageTTF, currentBlock,nextEpochStart,remainingTimeThisEpoch, remainingBlocksThisEpoch.
    Automatically calls itself to keep the site updated
    **/
function UpdateData()
{
    // Read data from ERGO explorer API
    var apiBlocks = $.get('https://api.ergoplatform.com/api/v0/blocks'),
        apiNetwork = $.get('https://api.ergoplatform.com/api/v0/stats');
        
    $.when(apiBlocks, apiNetwork).done( function(block, stats)
    {
        if( currentBlock != block[0].total )
        {
            currentBlock = block[0].total;
            
            currentDifficulty = stats[0].miningCost.difficulty;
            averageTTF = stats[0].blockSummary.averageMiningTime / 1000;
            
            var blocksThisEpoch = (currentBlock) % epochSize;
            remainingBlocksThisEpoch = epochSize - blocksThisEpoch;     // diff adjusts every epoch
            nextEpochStart = currentBlock + remainingBlocksThisEpoch;
            remainingTimeThisEpoch = remainingBlocksThisEpoch * averageTTF;
            
            // Show results and kick up other async calculations
            UpdateUI();
            
            CalculateDifficulty(false);     // false = only do that once on page load
            
            GetLastTwoEpochData();
        }
    });
    
    setTimeout(UpdateData, 30*1000);
}

/** Update the UI.
    Called by UpdateData()
    **/
function UpdateUI()
{
    var txtDiff = $( "#currentDiff" );
    var txtTTF = $( "#ttf" );
    var txtHeight = $( "#currentHeight" );
    var txtRemainBlocks = $( "#remainingBlocks" );
    var txtRemainTime = $( "#remainingTime" );
    var txtNextChange = $( "#nextEpochStart" );
    var divProgress = $( "#progress" );
    var txtEstimatedDifficulty = $( "#estDifficulty" );
    
    var diffUnit = "GH/s";
    var diffNow = currentDifficulty;
    diffNow /= 1000;   //KH/s
    diffNow /= 1000;   //MH/s
    diffNow /= 1000;   //GH/s
    
    if( diffNow>1000)
    { 
        diffNow /= 1000;
        diffUnit = "TH";
    }
    
    if( diffNow>1000)
    { 
        diffNow /= 1000;
        diffUnit = "PH";
    }
    
    txtHeight.text(currentBlock);
    txtDiff.text(diffNow.toFixed(2) + diffUnit);
    txtTTF.text(lastEpochTTF.toFixed(2) + " / " + last64BlocksTTF.toFixed(2) + " seconds" );
    
    txtNextChange.text(nextEpochStart);
    txtRemainBlocks.text(remainingBlocksThisEpoch)
    
    var nextEpochRealDate = new Date( Date.now() );
    nextEpochRealDate.setSeconds(nextEpochRealDate.getSeconds() + remainingTimeThisEpoch);
    
    txtRemainTime.text("~" + remainingTimeThisEpoch.toHHMMSS() + " -> " + nextEpochRealDate.toLocaleString());
    
    var progress = 100 * remainingBlocksThisEpoch / epochSize;
    divProgress.width(progress + "%");
    
    if( estimatedDifficulty > 0 )
    {
        delta = estimatedDifficulty - desiredDifficulty;
        txtEstimatedDifficulty.text(estimatedDifficulty.toFixed(2) + estimatedDifficultyUnit /*+ " (off by " + delta.toFixed(2) + estimatedDifficultyUnit + ")" */);
    }
    
    // adjust spring
    var spring = $( "#spring" );
    spring.height(0);
    
    var h = $("#centered").height();
    h -= $("#results").height();
    h -= $("#header").height();
    h -= $("#footer").height();
    h-= 20;
    
    if(h<300)
        h=300;
    
    spring.height(h);
}

function decodeCompactBits(compact) {
    const size = (compact >> 24) & 0xFF
    const bytes = []
    bytes[3] = size
    if (size >= 1) bytes[4] = ((compact >> 16) & 0xFF)
    if (size >= 2) bytes[5] = ((compact >> 8) & 0xFF)
    if (size >= 3) bytes[6] = (compact & 0xFF)
    return decodeMPI(bytes, hasLength = true)
  }

/*function encodeCompactBits(requiredDifficulty) {
    const value = requiredDifficulty
    var result = 0
    var size = value.toByteArray.length
    if (size <= 3) {
      result = value.longValue << 8 * (3 - size)
    } else {
      result = value.shiftRight(8 * (size - 3)).longValue
    }
    // The 0x00800000 bit denotes the sign.
    // Thus, if it is already set, divide the mantissa by 256 and increase the exponent.
    if ((result & 0x00800000) != 0) {
      result >>= 8
      size += 1
    }
    result |= size << 24
    val a: Int = if (value.signum == -1) 0x00800000 else 0
    result |= a
    result
  }*/

function decodeMPI(mpi, hasLength) {
    var buf = null // scalastyle:ignore
    if (hasLength) {
      const length = readUint32BE(mpi)
      buf = mpi.slice(4,length+4).concat(Array(length-mpi.length+4).fill(0))
    } else {
      buf = mpi
    }
    if (buf.length == 0) {
      return BigInt(0)
    } else {
      const isNegative = (buf[0] & 0x80) == 0x80
      if (isNegative) buf[0] = (buf[0] & 0x7f)
      const hex = toHexString(buf)
      const result = BigInt(hex)
      if (isNegative) {
        return result*-1
      } else {
        return result
      }
    }
}

function toHexString(byteArray) {
    return "0x".concat(Array.from(byteArray, function(byte) {
      return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join(''))
  }

function readUint32BE(bytes) { 
    return ((bytes[0] & 0xff) << 24) | ((bytes[1] & 0xff) << 16) | ((bytes[2] & 0xff << 8) | (bytes[3] & 0xff))
}

function toWindows(inputArray, size) {
    return Array.from(
      {length: inputArray.length - (size - 1)}, //get the appropriate length
      (_, index) => inputArray.slice(index, index+size) //create the windows
    )
}

function calculate(previousHeaders) {
    const data = toWindows(previousHeaders,2).map(d => {
          const start = d[0]
          const end = d[1]
          const diff = BigInt(end.difficulty) * BigInt(desiredBlockTime*1000) * BigInt(epochSize) / BigInt(end.timestamp - start.timestamp)
          return [BigInt(end.height), diff]
    })
    const rawPredictedDiff = Number(interpolate(data))
    return Math.max(Math.min(rawPredictedDiff,currentDifficulty*1.5),currentDifficulty*0.5)
  }

  //y = a + bx
function interpolate(data) {
    const size = BigInt(data.length)
    if (size == 1) {
      return data.head._2
    } else {
      const xy = data.map(d => d[0] * d[1])
      const x = data.map(d => BigInt(d[0]))
      const x2 = data.map(d => BigInt(d[0]) * d[0])
      const y = data.map(d => d[1])
      const xySum = xy.reduce((partialSum, a) => partialSum + a, BigInt(0));
      const x2Sum = x2.reduce((partialSum, a) => partialSum + a, BigInt(0));
      const ySum = y.reduce((partialSum, a) => partialSum + a, BigInt(0));
      const xSum = x.reduce((partialSum, a) => partialSum + a, BigInt(0));

      const b = (xySum * size - xSum * ySum) * BigInt(PrecisionConstant) / (x2Sum * size - xSum * xSum)
      const a = (ySum * BigInt(PrecisionConstant) - b * xSum) / size / BigInt(PrecisionConstant)

      const point = data[data.length-1][0] + BigInt(epochSize)
      return a + b * point / BigInt(PrecisionConstant)
    }
  }

/** Reads the last 7 epochs from ERGO explorer server. 
    Takes the difficulty of the first block and calculates the average.
    Writes the result into estimatedDifficulty, estimatedDifficultyUnit.
    
    TODO:
    - Add caching
    */
function CalculateDifficulty(force)
{
    // Protect the explorer server from too many requests...
    if(estimatedDifficulty == 0 || force == true)
    {   
        estimatedDifficulty=-1;
        $("#refreshEstdDifficulty").css("display", "none");

        var start = epochSize-(nextEpochStart-currentBlock);
        const ergExplorerBlockAPI = "https://api.ergoplatform.com/api/v0/blocks?limit=1&offset=";
        var epoch8 = ergExplorerBlockAPI + 0;
        var epoch7 = ergExplorerBlockAPI + start,
            epoch6 = ergExplorerBlockAPI + (start+epochSize),
            epoch5 = ergExplorerBlockAPI + (start+epochSize*2),
            epoch4 = ergExplorerBlockAPI + (start+epochSize*3),
            epoch3 = ergExplorerBlockAPI + (start+epochSize*4),
            epoch2 = ergExplorerBlockAPI + (start+epochSize*5),
            epoch1 = ergExplorerBlockAPI + (start+epochSize*6),
            epoch0 = ergExplorerBlockAPI + (start+epochSize*7);
            
        // Need to read the epochs in serial. If we do it in parallel cloudflare DDOS protection kicks in...
        $.getJSON(epoch0, function(z) {
        $.getJSON(epoch8, function(x) {
        $.getJSON(epoch7, function(a) {
            $( "#estDifficulty" ).text("14%");
            $.getJSON(epoch6, function(b) {
                $( "#estDifficulty" ).text("28%");
                $.getJSON(epoch5, function(c) {
                    $( "#estDifficulty" ).text("42%");
                    $.getJSON(epoch4, function(d) {
                        $( "#estDifficulty" ).text("57%");
                        $.getJSON(epoch3, function(e) {
                            $( "#estDifficulty" ).text("71%");
                            $.getJSON(epoch2, function(f) {
                                $( "#estDifficulty" ).text("85%");
                                $.getJSON(epoch1, function(g) {
                                    // ERGO diff is based on the diff of the last 7 epochs
                                    // https://eprint.iacr.org/2017/731.pdf
                                    
                                    // This is probably not exact how the algo really works. I will fine tune it later...
                                    // To prevent overflows we use GH/s
                                    var headers = [];
                                    headers.push( z.items[0] );
                                    headers.push( g.items[0] );
                                    headers.push( f.items[0] );
                                    headers.push( e.items[0] );
                                    headers.push( d.items[0] );
                                    headers.push( c.items[0] );
                                    headers.push( b.items[0] );
                                    headers.push( a.items[0] );
                                    
                                    var newX = JSON.parse(JSON.stringify(x));
                                    newX.items[0].timestamp = a.items[0].timestamp+Math.floor((x.items[0].timestamp-a.items[0].timestamp)/(epochSize-remainingBlocksThisEpoch)*epochSize)
                                    newX.items[0].height = x.items[0].height+remainingBlocksThisEpoch

                                    headers.push( newX.items[0] )
                                    
                                    // // Now calc the expected diff for next epoch
                                    // // TODO: Use last 8 blocks TTF
                                    // var ttf = last64BlocksTTF;
                                    // if(ttf==0) ttf = averageTTF;    // might be 0 if GetLastTwoEpochData() was too slow...
                                    
                                    // var D = epochSize * desiredBlockTime / (ttf*epochSize);
                                    // desiredDifficulty = (D * currentDifficulty)/1000000000;
                                    // diffs.push( desiredDifficulty );
                                    
                                    // // Have an x (time) axis array for the linear regression
                                    // var times = [0,1,2,3,4,5,6,7];
                                    
                                    // // Apply linear regression
                                    // var lr = findLineByLeastSquares(times, diffs);
                                    // var diff = lr[1][7];

                                    var diff = calculate(headers)/PrecisionConstant
                                    
                                    if( diff>1000)
                                    { 
                                        diff /= 1000;
                                        desiredDifficulty /= 1000;
                                        estimatedDifficultyUnit = "TH";
                                    }
                                    
                                    if( diff>1000)
                                    { 
                                        diff /= 1000;
                                        desiredDifficulty /= 1000;
                                        estimatedDifficultyUnit = "PH";
                                    }
                                    estimatedDifficulty = diff;
                                    
                                    // Turn refresh button on again
                                    $("#refreshEstdDifficulty").css("display", "block");
                                    
                                    // Flush results out
                                    UpdateUI();
                                })
                            })
                        })
                    })
                })
            })
        })})});
    }
}

/**
    Fetches the block history of the last 2 epochs from the server...
    Result goes to lastTwoEpchData.
    
    TODO: 
    - Add option to only load the last added block to save resources.
*/
var lastTwoEpchData = null;

function GetLastTwoEpochData()
{
    const ergExplorerBlockAPI = "https://api.ergoplatform.com/api/v0/blocks?limit=512&offset=";
    var chunk1 = ergExplorerBlockAPI + "0",
        chunk2 = ergExplorerBlockAPI + "512",
        chunk3 = ergExplorerBlockAPI + "1024",
        chunk4 = ergExplorerBlockAPI + "1536";
    
    $.getJSON(chunk1, function(a) {
        $.getJSON(chunk2, function(b) {
            $.getJSON(chunk3, function(c) {
                $.getJSON(chunk4, function(d) {
                    
                    d = d.items.reverse();
                    d = d.concat(c.items.reverse());
                    d = d.concat(b.items.reverse());
                    d = d.concat(a.items.reverse());
                    
                    lastTwoEpchData = d;
                    
                    // Get diff + times from the datasets...
                    CalculateLastTwoEpochData();
                })
            })
        })
    });
}

/**
    Calculates the difficulties and blocktimes for the last two epochs' blocks.
    Results go to lastTwoEpchDifficulties and lastTwoEpochBlockTimes.
    Also calculates lastEpochTTF and last64BlocksTTF.
*/
var lastTwoEpochDifficulties = null;
var lastTwoEpochBlockTimes = null;
var lastTwoEpochChartLabels = null;     // timestamps

function CalculateLastTwoEpochData()
{
    if(lastTwoEpchData == null)
        return; // Data not ready yet...
    
    var dataLabels = new Array();
    var difficulties = new Array();
    var blockTimes = new Array()
    var lastTime = 0, avg = 0, cnt = 0, diffAvg=0;
    
    const blckAvg = 64;                     // Blocks to consolidate into one datapoint, must be a multiple of 2
    lastTwoEpchData.forEach( function(item)
    {
        if(lastTime>0)
        {
            var ttf = item.timestamp - lastTime;
            ttf /= 1000;
            
            // Get the avg. hash rate of n blocks
            if(++cnt >= blckAvg )
            {
                avg += ttf;
                avg /= blckAvg;
                
                diffAvg += item.difficulty/1000000000000000;
                diffAvg /= blckAvg;
                
                blockTimes.push(avg);
                difficulties.push(diffAvg);
                
                var dd = new Date(item.timestamp);
                dataLabels.push(("00" + dd.getDate()).slice(-2) +". "+ ("00"+dd.getHours()).slice(-2) +":"+ ("00"+dd.getMinutes()).slice(-2));
                cnt = 1;
            }
            else
            {
                avg += ttf;
                diffAvg += item.difficulty/1000000000000000;
            }
        }
        lastTime = item.timestamp;
    });
    
    // Get moving average block time for diff predictions.
    // The way we calculate the moving average significantly influences 
    // nethash estimates and difficulty predictions
    // I'm still fine tuning it...
    // __16__ datapoints * 64 Blocks = 1024 Blocks = 1 Epoch
    var dpBlockTimes = movingAvg(blockTimes, 16, 0);      // 2nd param is the n previous, 3rd param the n following datapoints to average
    
    lastEpochTTF = 0;
    var blkEpochCnt = 1024/blckAvg;         // Datapoints that one epoch consists of
    for(var i=1; i < blkEpochCnt; i++ )
    {
        lastEpochTTF += dpBlockTimes[dpBlockTimes.length-i];
    }
    lastEpochTTF /= blkEpochCnt;
    
    // Get the calculated blocktimes for last blckAvg blocks
    last64BlocksTTF = blockTimes[blockTimes.length-1];
    
    lastTwoEpochDifficulties = difficulties;
    lastTwoEpochBlockTimes = blockTimes;
    lastTwoEpochChartLabels = dataLabels;
    
    // When done call ShowChart to make it visible
    ShowChart();
}

/**
    Toggles through the different available chart types...
*/
function ToggleChartType()
{
    if(++blockTimeChartType > 1)
        blockTimeChartType = 0;
    
    ShowChart();
}

/** 
    Shows a ChartJS 3 diagram.
    Which one if defined by blockTimeChartType.
*/
function ShowChart()
{
    // Kill old chart
    // To prevent the old one being displayed while data is loading async
    if(blockTimeChart!=null)
    {   blockTimeChart.destroy();
        blockTimeChart = null;
    }
    
    if( blockTimeChartType == 1 )
        ShowChart_DiffHistory();
    else
        ShowChart_LastTwoEpochs();
    
    // Enable the chart type toggle.
    $("#toggleChartType").css("display", "block");
}

/** 
    Shows a ChartJS 3 diagram with blocktime, difficulties and calculated net hash of the last two epochs.
*/
function ShowChart_LastTwoEpochs()
{
    if( lastTwoEpochChartLabels == null)
        return;     // Data not ready ...
    
    // Get moving average of the esitmated block times.
    var nhBlockTimes = movingAvg(lastTwoEpochBlockTimes, 2, 2);      // 2nd param is the n previous, 3rd param the n following blocks to average
    
    // Get the net hash from blocktime and diff
    var netHashPoints = new Array(), cnt = 0;
    nhBlockTimes.forEach( function(item)
    {
        var nh = lastTwoEpochDifficulties[cnt++] * 1000 / item;
        netHashPoints.push(nh);
    });
    
    // Smoothen the net hash graph a little
    // Here we ignore the past datasets as using them will "offset" the result of difficulty changes in time.
    netHashPoints = movingAvg(netHashPoints, 0, 2);
    
    var chartData = {
              labels: lastTwoEpochChartLabels,
              datasets: [
              {
                label: "Difficulty (PH)",
                type: 'line',
                data: lastTwoEpochDifficulties,
                borderColor: '#ff4221',
                yAxisID: 'dif',
                tension: 0.1
              },
              {
                label: "Block time (sec)",
                type: 'line',
                data: nhBlockTimes,
                borderColor: '#bbb',
                yAxisID: 'y',
                tension: 0.1
              }, {
                label: "Net hash (TH/s)",
                type: 'line',
                data: netHashPoints,
                borderColor: '#12a5ee',
                yAxisID: 'nh',
                tension: 0.1
              }]
            };
    
    var ctx = $("#chart").get(0).getContext("2d");
    
    if(blockTimeChart!=null)
        blockTimeChart.destroy();
    
    blockTimeChart = new Chart(ctx, 
    {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: 
            {
              mode: 'index',
              intersect: false,
            },
            stacked: false,
            scales: 
            {
                y: 
                {
                    type: 'linear',
                    display: false,
                    position: 'left',
                },
                nh: 
                {
                    type: 'linear',
                    display: false,
                    position: 'right',
                    
                    // grid line settings
                    grid: 
                    {
                        drawOnChartArea: false, // only want the grid lines for one axis to show up
                    },
                },
                dif: 
                {
                    type: 'linear',
                    display: false,
                    position: 'right',
                    
                    // grid line settings
                    grid: 
                    {
                        drawOnChartArea: false, // only want the grid lines for one axis to show up
                    },
                },
            }
        }
    });
    
    $("#chartInfo").text("Showing 2 epochs (2048 blocks, 64 as one datapoint). Ideal block time is 120s.");
}

/** 
    Shows a ChartJS 3 diagram with blocktime and difficulty of the last epochs
*/
var historyOffset = 0;
var historyBlocks = new Array();
var historyLoaded = 0;
var historyBlockTimeLinear = new Array();

function ShowChart_DiffHistory()
{
    if(historyLoaded == 0)
        FetchDiffHistory(); // Is async...
    
    if(historyLoaded == 1)  // don't make this an else if! the var might be changed in FetchDiffHistory() call!
    {
        var difficulties = new Array(), blockTimes = new Array();
        
        // Set up chart datasets
        var dataLabels = new Array();
        const phScale = 1000000000000000;
        var lastTime = 0;
        historyBlocks.forEach( function(item)
        {
            if( lastTime != 0 )
            {
                var bt = (item.timestamp - lastTime) / 1024;    // divide by epoch length to get avg. blocktime
                bt /= 1000; // to seconds
                difficulties.push(item.difficulty/phScale);
                
                var dd = new Date(item.timestamp);
                dataLabels.push(("00" + dd.getDate()).slice(-2) +"."+ ("00"+(dd.getMonth()+1)).slice(-2) +"."+ ("00"+dd.getFullYear()).slice(-2));
                
                blockTimes.push(bt);
            }
            
            lastTime = item.timestamp;
            
        });
        
        // Apply lin reg to the block time
        var xAxis = new Array();
        for(var idx = 0; idx < blockTimes.length; idx++)
            xAxis.push(idx);
        
        historyBlockTimeLinear = findLineByLeastSquares(xAxis, blockTimes)[1];
        
        var chartData = 
        {
            labels: dataLabels, 
            datasets: [
            {
                label: "Difficulty (PH)",
                type: 'line',
                data: difficulties,
                borderColor: '#ff4221',
                yAxisID: 'dif',
                tension: 0.1
            },
            {
                label: "Block time (sec)",
                type: 'line',
                data: blockTimes,
                borderColor: '#bbb',
                yAxisID: 'y',
                tension: 0.1
            },
            {
                label: "Block time (sec, lin)",
                type: 'line',
                data: historyBlockTimeLinear,
                borderColor: '#12a5ee',
                yAxisID: 'y',
                tension: 0.1
            }]
        };
        
        var ctx = $("#chart").get(0).getContext("2d");
        
        if(blockTimeChart!=null)
            blockTimeChart.destroy();
        
        blockTimeChart = new Chart(ctx, 
        {
            type: 'line',
            data: chartData,
            options: 
            {
                responsive: true,
                maintainAspectRatio: false,
                interaction: 
                {
                  mode: 'index',
                  intersect: false,
                },
                stacked:false,
                
                scales: 
                {
                    y: 
                    {
                        type: 'linear',
                        display: false,
                        position: 'left',
                    },
                    dif: 
                    {
                        type: 'linear',
                        display: false,
                        position: 'right',
                        
                        // grid line settings
                        grid: 
                        {
                            drawOnChartArea: false, // only want the grid lines for one axis to show up
                        },
                    },
                }
            }
        });
        
        $("#chartInfo").text("Difficulty and blocktime of the last " + (blockTimes.length+1) + " epochs. Ideal block time is 120s.");
    }
}

/**
    Fetches the difficulty history from the server and/or precache.
*/
var historyEpochsToLoad = 32;
function FetchDiffHistory()
{
    
    if( historyLoaded == 0 )
    {
        historyOffset = (historyEpochsToLoad*1024)
        historyLoaded = -1;
    }
    
    if( historyLoaded == -1 )
    {
        historyOffset-=1024;
    }
    
    if(historyEpochsToLoad-->0)
    {
        $("#chartInfo").text("Loading... " + historyEpochsToLoad + " epochs to go.");
        var jsonURL = "https://api.ergoplatform.com/api/v0/blocks?limit=1&offset=" + (historyOffset);
        $.getJSON(jsonURL, function(a) {
            var item = new Object();
            item.timestamp = a.items[0].timestamp;
            item.difficulty = a.items[0].difficulty;
            historyBlocks.push(item);
            
            FetchDiffHistory();
        });
    }
    else
    {
        historyLoaded = 1;
        
        ShowChart();
    }
}

// https://stackoverflow.com/questions/6312993/javascript-seconds-to-time-string-with-format-hhmmss
Number.prototype.toHHMMSS = function () 
{
    var sec_num = this;
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);
    seconds = seconds.toFixed(0)

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
}

// https://stackoverflow.com/a/63348486
function movingAvg(array, countBefore, countAfter) 
{
    if (countAfter == undefined) countAfter = 0;
    const result = [];
    for (let i = 0; i < array.length; i++) 
    {
        const subArr = array.slice(Math.max(i - countBefore, 0), Math.min(i + countAfter + 1, array.length));
        const avg = subArr.reduce((a, b) => a + (isNaN(b) ? 0 : b), 0) / subArr.length;
        result.push(avg);
    }
    return result;
}

// https://dracoblue.net/dev/linear-least-squares-in-javascript/
function findLineByLeastSquares(values_x, values_y) 
{
    var sum_x = 0;
    var sum_y = 0;
    var sum_xy = 0;
    var sum_xx = 0;
    var count = 0;

    /*
     * We'll use those variables for faster read/write access.
     */
    var x = 0;
    var y = 0;
    var values_length = values_x.length;

    if (values_length != values_y.length) {
        throw new Error('The parameters values_x and values_y need to have same size!');
    }

    /*
     * Nothing to do.
     */
    if (values_length === 0) {
        return [ [], [] ];
    }

    /*
     * Calculate the sum for each of the parts necessary.
     */
    for (var v = 0; v < values_length; v++) 
    {
        x = values_x[v];
        y = values_y[v];
        sum_x += x;
        sum_y += y;
        sum_xx += x*x;
        sum_xy += x*y;
        count++;
    }

    /*
     * Calculate m and b for the formular:
     * y = x * m + b
     */
    var m = (count*sum_xy - sum_x*sum_y) / (count*sum_xx - sum_x*sum_x);
    var b = (sum_y/count) - (m*sum_x)/count;

    /*
     * We will make the x and y result line now
     */
    var result_values_x = [];
    var result_values_y = [];

    for (var v = 0; v < values_length; v++) 
    {
        x = values_x[v];
        y = x * m + b;
        result_values_x.push(x);
        result_values_y.push(y);
    }

    return [result_values_x, result_values_y];
}