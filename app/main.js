// GAME SETUP
var initialState = SKIPSETUP ? "playing" : "setup";
var gameState = new GameState({state: initialState});
var cpuBoard = new Board({autoDeploy: SKIPSETUP, name: "cpu"});
var playerBoard = new Board({autoDeploy: SKIPSETUP, name: "player"});
var cursor = new Cursor();

// UI SETUP
setupUserInterface();

// selectedTile: The tile that the player is currently hovering above
var selectedTile = false;

// grabbedShip/Offset: The ship and offset if player is currently manipulating a ship
var grabbedShip = false;
var grabbedOffset = [0, 0];
var rollOffset = 0;

// isGrabbing: Is the player's hand currently in a grabbing pose
var isGrabbing = false;

var grabbingHistory = [];

// MAIN GAME LOOP
// Called every time the Leap provides a new frame of data
Leap.loop({ hand: function(hand) {
  // Clear any highlighting at the beginning of the loop
  unhighlightTiles();

  // Use the hand data to control the cursor's screen position
  var cursorPosition = hand.screenPosition();
  var translateVector = Leap.vec3.fromValues(0, 250, -100);
  var returnVector = Leap.vec3.create();
  var translatedCursor = Leap.vec3.add(returnVector, cursorPosition, translateVector);
  cursor.setScreenPosition(translatedCursor);

  // 4.1
  // Get the tile that the player is currently selecting, and highlight it
  selectedTile = getIntersectingTile(translatedCursor);
  if (selectedTile) {
    highlightTile(selectedTile, Colors.GREEN);
  }

  // SETUP mode
  if (gameState.get('state') == 'setup') {
    background.setContent("<h1>battleship</h1><h3 style='color: #7CD3A2;'>deploy ships</h3>");

    // Enable the player to grab, move, rotate, and drop ships to deploy them

    // First, determine if grabbing pose or not
    var wasGrabbing = isGrabbing;

    isGrabbing = false;
    var intersectingShipInfo = getIntersectingShipAndOffset(translatedCursor);
    if (intersectingShipInfo) {
      var grabStrength = hand.grabStrength;
      var pinchStrength = hand.pinchStrength;
      var grabThreshold = wasGrabbing ? 0.99 : 0.8;
      var pinchThreshold = wasGrabbing ? 0.8 : 0.6;
      if (grabStrength > grabThreshold | pinchStrength > pinchThreshold) {
        isGrabbing = true;
      }
    }

    grabbingHistory.push(isGrabbing);
    if (grabbingHistory.length > 10) grabbingHistory.shift();

    // check if actually want to grab again
    if (!wasGrabbing && isGrabbing) {
      var recents = grabbingHistory.slice(Math.max(grabbingHistory.length - 5, 0));
      if (recents.indexOf(false) > -1) {
        isGrabbing = false;
      }
    }

    // check if actually want to release
    if (wasGrabbing && !isGrabbing) {
      var recents = grabbingHistory.slice(Math.max(grabbingHistory.length - 5, 0));
      if (recents.indexOf(true) > -1) {
        isGrabbing = true;
      }
    }

    // Grabbing, but no selected ship yet. Look for one.
    // Update grabbedShip/grabbedOffset if the user is hovering over a ship
    if (!grabbedShip && isGrabbing) {
      grabbedShip = intersectingShipInfo.ship;
      grabbedOffset = intersectingShipInfo.offset;
      rollOffset = grabbedShip.getScreenRotation() + 2*hand.roll();
    }

    // Has selected a ship and is still holding it
    // Move the ship
    else if (grabbedShip && isGrabbing) {
      var handX = translatedCursor[0];
      var handY = translatedCursor[1];
      grabbedShip.setScreenPosition([handX - grabbedOffset[0], handY - grabbedOffset[1]]);

      var rotation = -2*hand.roll();
      grabbedShip.setScreenRotation(rollOffset + rotation);
    }

    // Finished moving a ship. Release it, and try placing it.
    // Try placing the ship on the board and release the ship
    else if (grabbedShip && !isGrabbing) {
      placeShip(grabbedShip);
      grabbedShip = false;
    }
  }

  // PLAYING or END GAME so draw the board and ships (if player's board)
  // Note: Don't have to touch this code
  else {
    if (gameState.get('state') == 'playing') {
      background.setContent("<h1>battleship</h1><h3 style='color: #7CD3A2;'>game on</h3>");
      turnFeedback.setContent(gameState.getTurnHTML());
    }
    else if (gameState.get('state') == 'end') {
      var endLabel = gameState.get('winner') == 'player' ? 'you won!' : 'game over';
      background.setContent("<h1>battleship</h1><h3 style='color: #7CD3A2;'>"+endLabel+"</h3>");
      turnFeedback.setContent("");
    }

    var board = gameState.get('turn') == 'player' ? cpuBoard : playerBoard;
    // Render past shots
    board.get('shots').forEach(function(shot) {
      var position = shot.get('position');
      var tileColor = shot.get('isHit') ? Colors.RED : Colors.YELLOW;
      highlightTile(position, tileColor);
    });

    // Render the ships
    playerBoard.get('ships').forEach(function(ship) {
      if (gameState.get('turn') == 'cpu') {
        var position = ship.get('position');
        var screenPosition = gridOrigin.slice(0);
        screenPosition[0] += position.col * TILESIZE;
        screenPosition[1] += position.row * TILESIZE;
        ship.setScreenPosition(screenPosition);
        if (ship.get('isVertical'))
          ship.setScreenRotation(Math.PI/2);
      } else {
        ship.setScreenPosition([-500, -500]);
      }
    });

    // If playing and CPU's turn, generate a shot
    if (gameState.get('state') == 'playing' && gameState.isCpuTurn() && !gameState.get('waiting')) {
      gameState.set('waiting', true);
      generateCpuShot();
    }
  }
}}).use('screenPosition', {scale: LEAPSCALE});

// processSpeech(transcript)
//  Is called anytime speech is recognized by the Web Speech API
// Input: 
//    transcript, a string of possibly multiple words that were recognized
// Output: 
//    processed, a boolean indicating whether the system reacted to the speech or not
var processSpeech = function(transcript) {
  // Helper function to detect if any commands appear in a string
  var userSaid = function(str, commands) {
    for (var i = 0; i < commands.length; i++) {
      if (str.indexOf(commands[i]) > -1)
        return true;
    }
    return false;
  };

  var processed = false;
  if (gameState.get('state') == 'setup') {
    // 4.3, Starting the game with speech
    // Detect the 'start' command, and start the game if it was said
    if (userSaid(transcript.toLowerCase(), ['start'])) {
      gameState.startGame();
      processed = true;
    } 

    // new method #1 for setup
    else if (userSaid(transcript.toLowerCase(), ['board'])) {
      if (userSaid(transcript.toLowerCase(), ['battleship'])) {
        putShipOnBoard('battleship');
      } else if (userSaid(transcript.toLowerCase(), ['patrol', 'boat'])) {
        putShipOnBoard('patrolBoat');
      }
    } else if (userSaid(transcript.toLowerCase(), ['move'])) {
      var shipType  = userSaid(transcript.toLowerCase(), ['battleship']) ? 'battleship' : 
                      userSaid(transcript.toLowerCase(), ['patrol', 'boat']) ? 'patrolBoat' : undefined;
      var direction = userSaid(transcript.toLowerCase(), ['left']) ? 'left' : 
                      userSaid(transcript.toLowerCase(), ['right']) ? 'right' : 
                      userSaid(transcript.toLowerCase(), ['up']) ? 'up' : 
                      userSaid(transcript.toLowerCase(), ['down']) ? 'down' : undefined;
      var numSpaces = userSaid(transcript.toLowerCase(), ['1', 'one']) ? 1 : 
                      userSaid(transcript.toLowerCase(), ['2', 'two']) ? 2 : 
                      userSaid(transcript.toLowerCase(), ['3', 'three']) ? 3 : 
                      userSaid(transcript.toLowerCase(), ['4', 'four']) ? 4 : 0;
      moveShip(shipType, direction, numSpaces);
    } else if (userSaid(transcript.toLowerCase(), ['turn', 'rotate'])) {
      var shipType  = userSaid(transcript.toLowerCase(), ['battleship']) ? 'battleship' : 
                      userSaid(transcript.toLowerCase(), ['patrol', 'boat']) ? 'patrolBoat' : undefined;
      rotateShip(shipType);
    }

    // new method #2 for setup
    else if (userSaid(transcript.toLowerCase(), ['here', 'there'])) {
      var shipType  = userSaid(transcript.toLowerCase(), ['battleship']) ? 'battleship' : 
                      userSaid(transcript.toLowerCase(), ['patrol', 'boat']) ? 'patrolBoat' : undefined;
      placeShipCursor(shipType);
    }
  }

  else if (gameState.get('state') == 'playing') {
    if (gameState.isPlayerTurn()) {
      // 4.4, Player's turn
      // Detect the 'fire' command, and register the shot if it was said
      if (userSaid(transcript.toLowerCase(), ['fire'])) {
        registerPlayerShot();
        processed = true;
      }
    }

    else if (gameState.isCpuTurn() && gameState.waitingForPlayer()) {
      // 4.5, CPU's turn
      // Detect the player's response to the CPU's shot: hit, miss, you sunk my ..., game over
      // and register the CPU's shot if it was said
      if (userSaid(transcript.toLowerCase(), ['hit', 'miss', 'mass', 'sunk', 'sank', 'game', 'over'])) {
        registerCpuShot(transcript);

        processed = true;
      }
    }
  }

  return processed;
};

// 4.4, Player's turn
// Generate CPU speech feedback when player takes a shot
var registerPlayerShot = function() {
  // CPU should respond if the shot was off-board
  if (!selectedTile) {
    generateSpeech("Please point at a tile to fire at.");
  }

  // If aiming at a tile, register the player's shot
  else {
    var shot = new Shot({position: selectedTile});
    var result = cpuBoard.fireShot(shot);

    // Duplicate shot
    if (!result) return;

    // Generate CPU feedback in three cases
    // Game over
    if (result.isGameOver) {
      generateSpeech("You won!");
      gameState.endGame("player");
      return;
    }
    // Sunk ship
    else if (result.sunkShip) {
      var shipName = result.sunkShip.get('type');
      generateSpeech("you sunk my " + shipName);
    }
    // Hit or miss
    else {
      var isHit = result.shot.get('isHit');
      var message = isHit ? "hit" : "miss";
      generateSpeech(message);
    }

    if (!result.isGameOver) {
      // uncomment nextTurn to move onto the CPU's turn
      nextTurn();
    }
  }
};

// 4.5, CPU's turn
// Generate CPU shot as speech and blinking
var cpuShot;
var generateCpuShot = function() {
  // Generate a random CPU shot
  cpuShot = gameState.getCpuShot();
  var tile = cpuShot.get('position');
  var rowName = ROWNAMES[tile.row]; // e.g. "A"
  var colName = COLNAMES[tile.col]; // e.g. "5"

  // Generate speech and visual cues for CPU shot
  generateSpeech("fire at " + rowName + colName);
  blinkTile(tile);
};

// 4.5, CPU's turn
// Generate CPU speech in response to the player's response
// E.g. CPU takes shot, then player responds with "hit" ==> CPU could then say "AWESOME!"
var registerCpuShot = function(playerResponse) {
  // Cancel any blinking
  unblinkTiles();
  var result = playerBoard.fireShot(cpuShot);

  // NOTE: Here we are using the actual result of the shot, rather than the player's response
  // In 4.6, you may experiment with the CPU's response when the player is not being truthful!

  // Generate CPU feedback in three cases
  // Game over
  if (result.isGameOver) {
    generateSpeech("haha I won!");
    gameState.endGame("cpu");
    return;
  }
  // Sunk ship
  else if (result.sunkShip) {
    var shipName = result.sunkShip.get('type');
    generateSpeech("there goes your " + shipName + "!");
  }
  // Hit or miss
  else {
    var isHit = result.shot.get('isHit');
    var message = isHit ? "yay!!!" : "oh nooo";
    var saidHit = (playerResponse.toLowerCase().indexOf("hit") > -1);
    if (isHit && !saidHit) message = "Hey, you're lying! I know I hit your ship."
    generateSpeech(message);
  }

  if (!result.isGameOver) {
    // Uncomment nextTurn to move onto the player's next turn
    nextTurn();
  }
};

var putShipOnBoard = function(shipType) {
  var myShips = playerBoard.get('ships');
  var ship = myShips.findWhere({type:shipType});
  var shifLeft = Math.ceil(ship.get('length')/2) - 1;
  var x = gridOrigin[0] + (TILESIZE*(2-shifLeft)) - TILESIZE/2;
  var y = gridOrigin[1] + (TILESIZE*1.5);
  ship.setScreenPosition([x, y]);
  placeShip(ship);
};

var moveShip = function(shipType, direction, numSpaces) {
  var myShips = playerBoard.get('ships');
  var ship = myShips.findWhere({type:shipType});
  if (ship.get('isDeployed')) {
    var pos = ship.get('screenPosition');
    if (direction == "left") {
      pos[0] -= numSpaces*TILESIZE;
    } else if (direction == "right") {
      pos[0] += numSpaces*TILESIZE;
    } else if (direction == "up") {
      pos[1] -= numSpaces*TILESIZE;
    } else if (direction == "down") {
      pos[1] += numSpaces*TILESIZE;
    }
    ship.setScreenPosition(pos);
    placeShip(ship);
  }
};

var rotateShip = function(shipType) {
  var myShips = playerBoard.get('ships');
  var ship = myShips.findWhere({type:shipType});
  if (ship.get('isDeployed')) {
    var isVertical = ship.get('isVertical');
    if (!isVertical) {
      ship.setScreenRotation(Math.PI/2);
    } else {
      ship.setScreenRotation(0);
    }
    placeShip(ship);
  }
};

var placeShipCursor = function(shipType) {
  console.log('placing');
  var myShips = playerBoard.get('ships');
  var ship = myShips.findWhere({type:shipType});
  var pos = cursor.get('screenPosition');
  var i, j;
  if (ship.get('isVertical')) {
    i = 1;
    j = 0;
  } else {
    i = 0;
    j = 1;
  }
  pos[i] -= (TILESIZE/2 + (Math.ceil(ship.get('length')/2) - 1)*TILESIZE);
  pos[j] -= TILESIZE/2;
  ship.setScreenPosition(pos);
  placeShip(ship);
};

