/**
 * Flashcards module.
 *
 * @param {H5P.jQuery} $
 */
H5P.Flashcards = (function ($, XapiGenerator) {

  C.counter = 0;

  /**
   * Initialize module.
   *
   * @param {Object} options Run parameters
   * @param {Number} id Content identification
   * @param {object} extras Extras.
   */
  function C(options, id, extras) {
    const that = this;

    H5P.EventDispatcher.call(this);
    this.answers = [];
    this.numAnswered = 0;
    this.contentId = this.id = id;
    this.options = $.extend({}, {
      description: "What does the card mean?",
      progressText: "Card @card of @total",
      next: "Next",
      previous: "Previous",
      checkAnswerText: "Check answer",
      showSolutionsRequiresInput: true,
      defaultAnswerText: "Your answer",
      correctAnswerText: "Correct",
      incorrectAnswerText: "Incorrect",
      showSolutionText: "Correct answer",
      answerShortText: "A:",
      informationText: "Information",
      useSpeechRecognition: false,
      inputLanguage: 'en-US',
      caseSensitive: false,
      results: "Results",
      ofCorrect: "@score of @total correct",
      showResults: "Show results",
      retry : "Retry",
      cardAnnouncement: 'Incorrect answer. Correct answer was @answer',
      pageAnnouncement: 'Page @current of @total',
      audioNotSupported: 'Your browser does not support this audio.',
      listening: 'Listening ...',
      noMicrophoneAccess: 'No microphone access',
      pushToSpeak: 'Push to speak',
      or: 'or'
    }, options);
    this.$images = [];
    this.hasBeenReset = false;

    this.audioButtons = [];
    this.speechRecognitions = [];

    this.previousState = extras && extras.previousState ?
      extras.previousState :
      {};

    this.on('resize', this.resize, this);

    // Workaround for iOS
    if (screen.orientation) {
      screen.orientation.addEventListener('change', function () {
        that.handleOrientationChange();
      });
    }
    else {
      window.addEventListener('orientationchange', function () {
        that.handleOrientationChange();
      });
    }

    /*
     * Workaround (hopefully temporary) for KidsLoopLive that for whatever
     * reason does not use h5p-resizer.js.
     */
    window.addEventListener('resize', function () {
      that.resize();
    });
  }

  C.prototype = Object.create(H5P.EventDispatcher.prototype);
  C.prototype.constructor = C;

  C.prototype.handleOrientationChange = function () {
    const that = this;

    clearTimeout(this.orientationChangeTimeout);
    this.orientationChangeTimeout = setTimeout(function () {
      if (
        that.$inner &&
        document.activeElement &&
        document.activeElement.classList.contains('h5p-textinput')
      ) {
        that.previousFocus = document.activeElement;
        document.activeElement.blur();
      }

      that.trigger('resize');
    }, 250);
  };

  /**
   * Append field to wrapper.
   *
   * @param {H5P.jQuery} $container
   */
  C.prototype.attach = function ($container) {
    var that = this;

    if (this.isRoot()) {
      this.setActivityStarted();
    }

    this.$container = $container
      .addClass('h5p-flashcards')
      .html('<div class="h5p-loading">Loading, please wait...</div>');

    // Load card images. (we need their size before we can create the task)
    var loaded = 0;
    var load = function () {
      loaded++;
      if (loaded === that.options.cards.length) {
        that.cardsLoaded();
      }
    };

    for (var i = 0; i < this.options.cards.length; i++) {
      var card = this.options.cards[i];

      if (card.image !== undefined) {
        const $image = $('<img>', {
          'class': 'h5p-clue',
          src: H5P.getPath(card.image.path, this.id),
        });
        if (card.imageAltText) {
          $image.attr('alt', card.imageAltText);
        }

        if ($image.get().complete) {
          load();
        }
        else {
          $image.on('load', load);
        }

        this.$images[i] = $image;
      }
      else {
        this.$images[i] = $('<div class="h5p-clue"></div>');
        load();
      }
    }

    $('body').on('keydown', function (event) {
      // The user should be able to use the arrow keys when writing his answer
      if (event.target.tagName === 'INPUT') {
        return;
      }

      // Left
      if (event.keyCode === 37) {
        that.previous();
      }

      // Right
      else if (event.keyCode === 39) {
        that.next();
      }
    });
  };

  /**
   * Checks if the user anwer matches an answer on the card
   * @private
   *
   * @param card The card
   * @param userAnswer The user input
   * @return {Boolean} If the answer is found on the card
   */
  function isCorrectAnswer(card, userAnswer, caseSensitive) {
    var answer = C.$converter.html(card.answer || '').text();

    if (!caseSensitive) {
      answer = (answer ? answer.toLowerCase() : answer);
      userAnswer = (userAnswer ? userAnswer.toLowerCase() : userAnswer);
    }

    return C.splitAlternatives(answer).indexOf(userAnswer, '') !== -1;
  }

  /**
   * Get Score
   * @return {number}
   */
  C.prototype.getScore = function () {
    var that = this;

    return that.options.cards.reduce(function (sum, card, i) {
      return sum + (isCorrectAnswer(card, that.answers[i], that.options.caseSensitive) ? 1 : 0);
    }, 0);
  };

  /**
   * Get Score
   * @return {number}
   */
  C.prototype.getMaxScore = function () {
    return this.options.cards
      .filter( function (card) {
        return typeof card.answer !== 'undefined';
      })
      .length;
  };

  /**
   * Called when all cards has been loaded.
   */
  C.prototype.cardsLoaded = function () {
    var that = this;
    var $inner = this.$container.html(
      '<div class="h5p-description" title="' + this.options.description + '">' + this.options.description + '</div>' +
      '<div class="h5p-progress"></div>' +
      '<div class="h5p-inner" role="list"></div>' +
      '<div class="h5p-navigation">' +
        '<button type="button" class="h5p-button h5p-previous h5p-hidden" tabindex="0" title="' + this.options.previous + '" aria-label="' + this.options.previous + '"></button>' +
        '<button type="button" class="h5p-button h5p-next" tabindex="0" title="' + this.options.next + '" aria-label="' + this.options.next + '"></button>'
    ).children('.h5p-inner');

    // Create visual progress and add accessibility attributes
    this.$visualProgress = $('<div/>', {
      'class': 'h5p-visual-progress',
      'role': 'progressbar',
      'aria-valuemax': '100',
      'aria-valuemin': (100 / this.options.cards.length).toFixed(2)
    }).append($('<div/>', {
      'class': 'h5p-visual-progress-inner'
    })).appendTo(this.$container);

    this.$progress = this.$container.find('.h5p-progress');

    // Add cards
    for (var i = 0; i < this.options.cards.length; i++) {
      this.addCard(i, $inner);
    }

    // Recreate previous position
    if (
      typeof that.previousState.index !== 'number' ||
      that.previousState.index === this.options.cards.length
    ) {
      // No previous position or results
      this.setCurrent($inner.find('> :first-child'));
    }
    else {
      const currentCard = $inner.find('> .h5p-card')[that.previousState.index];
      this.setCurrent($(currentCard));
    }

    // Find highest image and set task height.
    var height = 0;
    for (i = 0; i < this.$images.length; i++) {
      var $image = this.$images[i];

      if ($image === undefined) {
        continue;
      }

      var imageHeight = $image.height();
      if (imageHeight > height) {
        height = imageHeight;
      }
    }

    // Active buttons
    var $buttonWrapper = $inner.next();
    this.$nextButton = $buttonWrapper.children('.h5p-next').click(function () {
      that.next();
    });
    this.$prevButton = $buttonWrapper.children('.h5p-previous').click(function () {
      that.previous();
    });

    if (this.options.cards.length < 2) {
      this.$nextButton.hide();
    }

    this.$current.next().addClass('h5p-next');

    $inner.initialImageContainerWidth = $inner.find('.h5p-imageholder').outerWidth();

    this.addShowResults($inner);
    this.createResultScreen();

    if (this.numAnswered === this.getMaxScore()) {
      this.$container.find('.h5p-show-results').show();
    }

    this.$inner = $inner;
    this.setProgress();
    this.trigger('resize');

    // Attach aria announcer
    this.$ariaAnnouncer = $('<div>', {
      'class': 'hidden-but-read',
      'aria-live': 'assertive',
      appendTo: this.$container,
    });
    this.$pageAnnouncer = $('<div>', {
      'class': 'hidden-but-read',
      'aria-live': 'assertive',
      appendTo: this.$container
    });

    // Announce first page if task was reset
    if (this.hasBeenReset) {
      // Read-speaker needs a small timeout to be able to read the announcement
      setTimeout(function () {
        this.announceCurrentPage();
      }.bind(this), 100);
    }

    // Previous state was showing results
    if (
      typeof this.previousState.index === 'number' &&
      this.previousState.index === this.options.cards.length
    ) {
      this.handleShowResults();
    }
  };

  /**
   * Add show results
   * @param {H5P.jQuery} $inner
   */
  C.prototype.addShowResults = function ($inner) {
    var that = this;

    var $showResults = $(
      '<div class="h5p-show-results">' +
        '<span class="h5p-show-results-icon"></span>' +
        '<button type="button" class="h5p-show-results-label">' + that.options.showResults + '</button>' +
        '<button type="button" class="h5p-show-results-label-mobile">' + that.options.results + '</button>' +
      '</div>'
    );

    $showResults
      .on('click', function () {
        that.handleShowResults();
      })
      .appendTo($inner.parent());
  };

  /**
   * Handle show results.
   */
  C.prototype.handleShowResults = function () {
    this.resetAudio();
    this.enableResultScreen();
    this.triggerXAPIProgressed(this.options.cards.length);
    this.trigger('kllStoreSessionState', undefined, { bubbles: true, external: true });
  };

  /**
   * Add card
   * @param {number} index
   * @param {H5P.jQuery} $inner
   */
  C.prototype.addCard = function (index, $inner) {
    var that = this;
    var card = this.options.cards[index];
    const cardId = ++C.counter;

    // Generate a new flashcards html and add it to h5p-inner
    var $card = $(
      '<div role="listitem" class="h5p-card h5p-animate' + (index === 0 ? ' h5p-current' : '') + '" aria-hidden="' + (index === 0 ? 'false' : 'true') + '"> ' +
        '<div class="h5p-cardholder">' +
          '<div class="h5p-imageholder">' +
            '<div class="h5p-flashcard-overlay">' +
            '</div>' +
          '</div>' +
          '<div class="h5p-foot">' +
            '<div class="h5p-imagetext" id="h5p-flashcard-card-' + cardId + '">' +
              (card.text !== undefined ? card.text : '') +
            '</div>' +
            '<div class="h5p-answer">' +
              '<div class="h5p-input">' +
                '<input type="text" class="h5p-textinput" tabindex="-1" placeholder="' + this.options.defaultAnswerText + '" aria-describedby="h5p-flashcard-card-' + cardId + '" autocomplete="off" spellcheck="false"/>' +
                '<button type="button" class="h5p-button h5p-check-button" tabindex="-1" title="' + this.options.checkAnswerText + '">' + this.options.checkAnswerText + '</button>' +
                '<button type="button" class="h5p-button h5p-icon-button" tabindex="-1" title="' + this.options.checkAnswerText + '"/>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>')
      .appendTo($inner);

    // Cards may not require an answer and thus no extra fields
    if (!card.answer) {
      $card.find('.h5p-answer').addClass('h5p-hidden');
      $card.find('.h5p-foot').addClass('h5p-no-answer');

      if (!card.text) {
        $card.find('.h5p-imageholder').addClass('h5p-image-only');
        $card.find('.h5p-foot').addClass('h5p-hidden');
        $card.find('.h5p-flashcard-overlay').addClass('h5p-hidden');
      }
    }

    const audioButton = new H5P.Flashcards.AudioButton(
      that.contentId,
      {
        sample: card.audio,
        audioNotSupported: that.options.audioNotSupported,
        a11y: {
          play: that.options.audioPlay,
          pause: that.options.audioPause
        }
      },
      {} // Prepared for previous state
    );

    // Keep track for silencing
    this.audioButtons.push(audioButton);

    $card.find('.h5p-imageholder')
      .prepend(this.$images[index])
      .prepend(audioButton.getDOM());

    // Add speech recognition to retrieve answer from microphone
    if (this.options.useSpeechRecognition) {
      const speechRecognition = new H5P.SpeechRecognition(
        {
          language: this.options.inputLanguage,
          l10n: {
            listening: this.options.listening,
            pushToSpeak: this.options.pushToSpeak,
            noMicrophoneAccess: this.options.noMicrophoneAccess
          },
          showLabel: false
        },
        {
          onResult: (result) => {
            if (!this.isMobileLandscape()) {
              $card.find('.h5p-textinput').val(result.phrases[0]).focus();
            }
          }
        }
      );
      $card.find('.h5p-input').prepend(speechRecognition.getButtonDOM());

      // Keep track for disabling/enabling
      this.speechRecognitions.push(speechRecognition);

      // Give button space next to text input field
      $card.find('.h5p-textinput').addClass('h5p-uses-speech-recognition');
    }

    $card.prepend($('<div class="h5p-flashcard-overlay"></div>').on('click', function () {
      if ($(this).parent().hasClass('h5p-previous')) {
        that.previous();
      }
      else {
        that.next();
      }
    }));

    // Add tip
    var $tip = H5P.JoubelUI.createTip(card.tip);
    if ($tip && $tip.length) { // Check for a jQuery object
      $tip.attr({
        tabindex: -1,
        title: this.options.informationText
      });
      $('.h5p-input', $card).append($tip).addClass('has-tip');
    }

    var $input = $card.find('.h5p-textinput');

    var handleClick = function (cardId) {
      const isRecreatingState = (typeof cardId === 'number');
      const currentIndex = (typeof cardId === 'number') ? cardId : index;

      that.resetAudio();

      var card = that.options.cards[currentIndex];
      var userAnswer = $input.val().trim();
      var userCorrect = isCorrectAnswer(card, userAnswer, that.options.caseSensitive);
      var done = false;

      if (userAnswer === '' && !that.isMobileLandscape()) {
        $input.focus();
      }

      if (!that.options.showSolutionsRequiresInput || userAnswer !== '' || userCorrect) {
        that.numAnswered++;

        // Deactivate input options
        if (that.speechRecognitions && that.speechRecognitions.length > currentIndex) {
          that.speechRecognitions[currentIndex].disableButton();
        }
        $input.add(this).attr('disabled', true);

        that.answers[currentIndex] = userAnswer;
        that.triggerXAPI('interacted');

        if (!isRecreatingState) {
          that.trigger('kllStoreSessionState', undefined, { bubbles: true, external: true });
          that.triggerXAPIAnswered({
            currentIndex: currentIndex,
            correct: userCorrect,
            answer: card.answer,
            response: userAnswer
          });
        }

        if (userCorrect) {
          $input.parent()
            .addClass('h5p-correct')
            .append('<div class="h5p-feedback-label" tabindex="-1" aria-label="' + that.options.correctAnswerText + '">' + that.options.correctAnswerText + '!</div>');
          $card.addClass('h5p-correct');

          $('<div class="h5p-solution">' +
            '<span class="solution-icon h5p-rotate-in"></span>' +
          '</div>').appendTo($card.find('.h5p-imageholder'));

          $input.siblings('.h5p-feedback-label').focus();
        }
        else {
          $input.parent()
            .addClass('h5p-wrong')
            .append('<span class="h5p-feedback-label" tabindex="-1" aria-label="' + that.options.incorrectAnswerText + '">' + that.options.incorrectAnswerText + '!</span>');
          $card.addClass('h5p-wrong');

          $('<div class="h5p-solution">' +
            '<span class="solution-icon h5p-rotate-in"></span>' +
            '<span class="solution-text">' +
              (that.options.cards[currentIndex].answer ?
                that.options.showSolutionText + ': <span>' + C.splitAlternatives(that.options.cards[currentIndex].answer).join('<span> ' + that.options.or + ' </span>') + '</span>' :
                '') + '</span>' +
          '</div>').appendTo($card.find('.h5p-imageholder'));

          const ariaText = that.options.cardAnnouncement.replace(
            '@answer',
            that.options.cards[currentIndex].answer
          );

          if (that.$ariaAnnouncer) {
            that.$ariaAnnouncer.html(ariaText);
          }
        }

        if (isRecreatingState) {
          return;
        }

        done = (that.numAnswered >= that.getMaxScore());

        // Emit screenshot
        setTimeout(function () {
          if (H5P && H5P.KLScreenshot) {
            H5P.KLScreenshot.takeScreenshot(
              {
                subContentId: that.options.cards[currentIndex].subContentId,
                getTitle: () => {
                  return that.options.pageAnnouncement
                    .replace('@current', that.$current.index() + 1)
                    .replace('@total', that.options.cards.length.toString());
                },
                trigger: that.trigger
              },
              that.$container.get(0)
            );
          }
        }, 1000); // Allow results to display

        if (!done) {
          that.nextTimer = setTimeout(that.next.bind(that), 3500);
        }
        else {
          that.last();
        }
      }

      if (done) {
        that.trigger(XapiGenerator.getXapiEvent(that));
        that.trigger('resize');
      }
    };

    $card.find('.h5p-check-button, .h5p-icon-button').click(handleClick);

    $input.keypress(function (event) {

      if (event.keyCode === 13) {
        handleClick();
        return false;
      }
    });

    // Recreate previous card state
    if (
      Array.isArray(that.previousState.cards) &&
      that.previousState.cards.length > index
    ) {
      // Card inputs
      $card.find('.h5p-textinput').val(that.previousState.cards[index].userAnswer || '');

      // Checked state
      if (
        that.previousState.cards[index].checked &&
        $card.find('.h5p-button.h5p-check-button').is(':visible')
      ) {
        handleClick(index);
      }
    }

    return $card;
  };

  /**
   * Reset audio from button.
   * @param {number} [id] Id of button to be reset.
   */
  C.prototype.resetAudio = function (id) {
    if (typeof id === 'number' && id >= 0 && id < this.audioButtons.length) {
      this.audioButtons[id].resetAudio();
      return;
    }

    this.audioButtons.forEach(function (button) {
      button.resetAudio();
    });
  };

  /**
   * Create result screen
   */
  C.prototype.createResultScreen = function () {
    var that = this;

    // Create the containers needed for the result screen
    this.$resultScreen = $('<div/>', {
      'class': 'h5p-flashcards-results',
    });

    $('<div/>', {
      'class': 'h5p-results-title',
      'text': this.options.results
    }).appendTo(this.$resultScreen);

    $('<div/>', {
      'class': 'h5p-results-score'
    }).appendTo(this.$resultScreen);

    $('<ul/>', {
      'class': 'h5p-results-list'
    }).appendTo(this.$resultScreen);

    this.$retryButton = $('<button/>', {
      'class': 'h5p-results-retry-button h5p-invisible h5p-button',
      'text': this.options.retry
    }).on('click', function () {
      that.resetTask();
    }).appendTo(this.$resultScreen);
  };

  /**
   * Enable result screen
   */
  C.prototype.enableResultScreen = function () {
    this.$inner.addClass('h5p-invisible');
    this.$inner.siblings().addClass('h5p-invisible');
    this.$resultScreen.appendTo(this.$container).addClass('show');

    var ofCorrectText = this.options.ofCorrect
      .replace(/@score/g, '<span>' + this.getScore() + '</span>')
      .replace(/@total/g, '<span>' + this.getMaxScore() + '</span>');

    this.$resultScreen.find('.h5p-results-score').html(ofCorrectText);

    // Create a list representing the cards and populate them
    for (var i = 0; i < this.options.cards.length; i++) {
      var card = this.options.cards[i];
      var $resultsContainer = this.$resultScreen.find('.h5p-results-list');

      var userAnswer = this.answers[i];
      var userCorrect = isCorrectAnswer(card, userAnswer, this.options.caseSensitive);

      var $listItem = $('<li/>', {
        'class': 'h5p-results-list-item' + (!userCorrect ? ' h5p-incorrect' : '')
      }).appendTo($resultsContainer);

      var $imageHolder = $('<div/>', {
        'class': 'h5p-results-image-holder',
      }).appendTo($listItem);

      if (card.image !== undefined) {
        $imageHolder.css('background-image', 'url("' + H5P.getPath(card.image.path, this.id) + '")');
      }
      else {
        $imageHolder.addClass('no-image');
      }

      $('<div/>', {
        'class': 'h5p-results-question',
        'text': card.text
      }).appendTo($listItem);

      var $resultsAnswer = $('<div/>', {
        'class': 'h5p-results-answer',
        'text': (card.answer) ? this.answers[i] : ''
      }).appendTo($listItem);

      if (card.answer && !userCorrect) {
        $resultsAnswer.prepend('<span>' + this.options.answerShortText + ' </span>');
        $resultsAnswer.append('<span> ' + this.options.showSolutionText + ': </span>');
        $resultsAnswer.append('<span class="h5p-correct">' + C.splitAlternatives(card.answer).join('<span> ' + this.options.or + ' </span>') + '</span>');
      }

      if (card.answer) {
        $('<div/>', {
          'class': 'h5p-results-box'
        }).appendTo($listItem);
      }
    }
    if (this.getScore() < this.getMaxScore()) {
      this.$retryButton.removeClass('h5p-invisible');
    }
  };

  /**
   * Set Progress
   */
  C.prototype.setProgress = function () {
    var index = this.$current.index();
    this.$progress.text((index + 1) + ' / ' + this.options.cards.length);
    this.$visualProgress
      .attr('aria-valuenow', ((index + 1) / this.options.cards.length * 100).toFixed(2))
      .find('.h5p-visual-progress-inner').width((index + 1) / this.options.cards.length * 100 + '%');

    this.trigger('kllStoreSessionState', undefined, { bubbles: true, external: true });
    this.triggerXAPIProgressed(index);
  };

  /**
   * Set card as current card.
   *
   * Adjusts classes and tabindexes for existing current card and new
   * card.
   *
   * @param {H5P.jQuery} $card
   *   Class to add to existing current card.
   */
  C.prototype.setCurrent = function ($card) {
    // Remove from existing card.
    if (this.$current) {
      this.$current.find('.h5p-textinput').attr('tabindex', '-1');
      this.$current.find('.joubel-tip-container').attr('tabindex', '-1');
      this.$current.find('.h5p-check-button').attr('tabindex', '-1');
      this.$current.find('.h5p-icon-button').attr('tabindex', '-1');
    }

    // Set new card
    this.$current = $card;

    /* We can't set focus on anything until the transition is finished.
       If we do, iPad will try to center the focused element while the transition
       is running, and the card will be misplaced */
    $card.one('transitionend', function () {
      if ($card.hasClass('h5p-current') && !$card.find('.h5p-textinput')[0].disabled) {
        if (!this.isMobileLandscape()) {
          $card.find('.h5p-textinput').focus();
        }
      }
      setTimeout(function () {
        this.announceCurrentPage();
      }.bind(this), 500);
    }.bind(this));

    // Update card classes
    $card.removeClass('h5p-previous h5p-next');
    $card.addClass('h5p-current');
    $card.attr('aria-hidden', 'false');

    $card.siblings()
      .removeClass('h5p-current h5p-previous h5p-next left right')
      .attr('aria-hidden', 'true')
      .find('.h5p-rotate-in').removeClass('h5p-rotate-in');

    $card.prev().addClass('h5p-previous');
    $card.next('.h5p-card').addClass('h5p-next');

    $card.prev().prevAll().addClass('left');
    $card.next().nextAll().addClass('right');

    // Update tab indexes
    $card.find('.h5p-textinput').attr('tabindex', '0');
    $card.find('.h5p-check-button').attr('tabindex', '0');
    $card.find('.h5p-icon-button').attr('tabindex', '0');
    $card.find('.joubel-tip-container').attr('tabindex', '0');
  };

  /**
   * Announces current page to assistive technologies
   */
  C.prototype.announceCurrentPage = function () {
    const pageText = this.options.pageAnnouncement
      .replace('@current', this.$current.index() + 1)
      .replace('@total', this.options.cards.length.toString());
    this.$pageAnnouncer.text(pageText);
  };

  /**
   * Display next card.
   */
  C.prototype.next = function () {
    var that = this;
    var $next = this.$current.next();

    that.resetAudio();

    clearTimeout(this.prevTimer);
    clearTimeout(this.nextTimer);

    if (!$next.length) {
      return;
    }

    that.setCurrent($next);
    if (!that.$current.next('.h5p-card').length) {
      that.$nextButton.addClass('h5p-hidden');
    }
    that.$prevButton.removeClass('h5p-hidden');
    that.setProgress();

    if ($next.is(':last-child') && that.numAnswered === that.getMaxScore()) {
      that.$container.find('.h5p-show-results').show();
    }

    that.trigger('resize');
  };

  /**
   * Display previous card.
   */
  C.prototype.previous = function () {
    var that = this;
    var $prev = this.$current.prev();

    that.resetAudio();

    clearTimeout(this.prevTimer);
    clearTimeout(this.nextTimer);

    if (!$prev.length) {
      return;
    }

    that.setCurrent($prev);
    if (!that.$current.prev().length) {
      that.$prevButton.addClass('h5p-hidden');
    }
    that.$nextButton.removeClass('h5p-hidden');
    that.setProgress();
    that.$container.find('.h5p-show-results').hide();

    that.trigger('resize');
  };

  /**
   * Display last card.
   */
  C.prototype.last = function () {
    var $last = this.$inner.children().last();
    this.setCurrent($last);
    this.$nextButton.addClass('h5p-hidden');
    if (this.options.cards.length > 1) {
      this.$prevButton.removeClass('h5p-hidden');
    }
    this.setProgress();
    this.$container.find('.h5p-show-results').show();
    this.trigger('resize');
  };

  /**
   * Trigger xAPI "progressed".
   * @param {number} index Index.
   */
  C.prototype.triggerXAPIProgressed = function (index) {
    var xAPIEvent = this.createXAPIEventTemplate('progressed');
    xAPIEvent.data.statement.object.definition.extensions['http://id.tincanapi.com/extension/ending-point'] = index + 1;
    this.trigger(xAPIEvent);
  };

  /**
   * Trigger xAPI "answered" for pseudo subcontent.
   */
  C.prototype.triggerXAPIAnswered = function (params) {
    // Pseudo instance for pseudo subcontent
    const instance = {
      contentId: this.contentId,
      subContentId: this.options.cards[params.currentIndex].subContentId,
      createXAPIEventTemplate: this.createXAPIEventTemplate,
      options: {
        description: this.options.pageAnnouncement
          .replace('@current', params.currentIndex + 1)
          .replace('@total', this.options.cards.length),
        cards: [this.options.cards[params.currentIndex]],
        caseSensitive: this.options.caseSensitive
      },
      parent: this,
      answers: [params.response],
      getTitle: function () {
        return 'Flashcards Page';
      },
      getScore: function () {
        return params.correct ? 1 : 0;
      },
      getMaxScore: function () {
        return 1;
      }
    };

    this.trigger(XapiGenerator.getXapiEvent(instance));
  };

  /**
   * Resets the whole task.
   * Used in contracts with integrated content.
   * @private
   */
  C.prototype.resetTask = function () {
    this.speechRecognitions.forEach(function (button) {
      button.enableButton();
    });

    this.previousState = {};

    this.numAnswered = 0;
    this.hasBeenReset = true;
    this.cardsLoaded();
    this.trigger('resize');
  };

  /**
   * Gather copyright information from cards.
   *
   * @returns {H5P.ContentCopyrights}
   */
  C.prototype.getCopyrights = function () {
    var info = new H5P.ContentCopyrights();

    // Go through cards
    for (var i = 0; i < this.options.cards.length; i++) {
      var image = this.options.cards[i].image;
      if (image !== undefined && image.copyright !== undefined) {
        var rights = new H5P.MediaCopyright(image.copyright);
        rights.setThumbnail(new H5P.Thumbnail(H5P.getPath(image.path, this.id), image.width, image.height));
        info.addMedia(rights);
      }
    }

    return info;
  };

  /**
   * Update the dimensions and imagesizes of the task.
   */
  C.prototype.resize = function () {
    var self = this;
    if (self.$inner === undefined) {
      return;
    }
    var maxHeight = 0;
    var maxHeightImage = 0;

    // Don't resize if trigger was opening/closing virtual keyboard on mobile
    if (
      self.isMobileLandscape() &&
      document.activeElement &&
      document.activeElement.classList.contains('h5p-textinput')
    ) {
      return;
    }

    // Change landscape layout on mobile
    if (typeof window.orientation === 'number') {
      this.$container.toggleClass('h5p-landscape', self.isMobileLandscape());
    }

    this.containerStyle = this.containerStyle || getComputedStyle(this.$container.get(0));
    const baseFontSize = parseInt(this.containerStyle.getPropertyValue('font-size'));

    if (this.$inner.width() / parseFloat($("body").css("font-size")) <= 31) {
      self.$container.addClass('h5p-mobile');
    }
    else {
      self.$container.removeClass('h5p-mobile');
    }

    const displayLimits = (this.isRoot()) ? self.computeDisplayLimitsKLL() : null;

    //Find container dimensions needed to encapsule image and text.
    self.$inner.children('.h5p-card').each(function () {

      // Prevent huge cards on larger displays
      if (displayLimits &&
        displayLimits.height >= C.PAD_LANDSCAPE_MIN_HEIGHT) {
        displayLimits.height = Math.min(
          displayLimits.height,
          displayLimits.width / 16 * 9 // 16/9 as desired format
        );
      }

      if (displayLimits && self.isMobileLandscape()) {
        // Limit card size, 8 and 4 are default margins and paddings
        $(this).css({
          'max-width': (displayLimits.width - 8 * baseFontSize) + 'px',
          'max-height': (displayLimits.height - 4 * baseFontSize) + 'px'
        });

        $(this).find('.h5p-clue')
          .toggleClass('h5p-small', displayLimits.height - 4 * baseFontSize < 152);
      }
      else {
        // Limit card size, 8 and 4 are default margins and paddings
        $(this).css({
          'max-width': '',
          'max-height': ''
        });
      }

      var cardholderHeight = maxHeightImage + $(this).find('.h5p-foot').outerHeight();
      var $button = $(this).find('.h5p-check-button');
      var $tipIcon = $(this).find('.joubel-tip-container');
      var $textInput = $(this).find('.h5p-textinput');
      maxHeight = cardholderHeight > maxHeight ? cardholderHeight : maxHeight;

      // Handle scaling and positioning of answer button, textfield and info icon, depending on width of answer button.
      if ($button.outerWidth() > $button.parent().width() * 0.4) {
        $button.parent().addClass('h5p-exceeds-width');
        $tipIcon.attr("style", "");
        $textInput.attr("style", "");
      }
      else {
        $button.parent().removeClass('h5p-exceeds-width');
        $tipIcon.css('right', $button.outerWidth());
        var emSize = parseInt($textInput.css('font-size'));
        $textInput.css('padding-right', $button.outerWidth() + ($textInput.parent().hasClass('has-tip') ? emSize * 2.5 : emSize));
      }

      // Workaround for very narrow landscape displays
      const $answer = $(this).find('.h5p-answer');
      if (displayLimits && self.isMobileLandscape()) {
        if ($(this).find('.h5p-foot').width() < $textInput.outerWidth()) {
          let fontSizeEm = 1;

          while (
            fontSizeEm > 0.1 &&
            $(this).find('.h5p-foot').width() < $textInput.outerWidth() ||
            ($(this).find('.h5p-button.h5p-icon-button').outerWidth() / $(this).find('.h5p-input').outerWidth()) > 0.2
          ) {
            $answer.css('fontSize', fontSizeEm + 'em');
            fontSizeEm -= 0.1;
          }
        }
      }
      else {
        $answer.css('fontSize', '');
      }
    });

    var freeSpaceRight = this.$inner.children('.h5p-card').last().css("marginRight");

    if (parseInt(freeSpaceRight) < 160) {
      this.$container.find('.h5p-show-results')
        .addClass('h5p-mobile')
        .css('width', '');
    }
    else if (freeSpaceRight !== 'auto') {
      this.$container.find('.h5p-show-results')
        .removeClass('h5p-mobile')
        .width(freeSpaceRight);
    }

    // Reduce font size if mobile landscape
    if (displayLimits && this.isMobileLandscape()) {
      this.$inner.children('.h5p-card').each(function () {

        // Limit card height, 4 and 6 are default margins and paddings
        $(this).find('.h5p-cardholder').css({
          'height': (displayLimits.height - 4 * baseFontSize) + 'px'
        });

        $(this).find('.h5p-foot').css({
          'max-height': (displayLimits.height - 6 * baseFontSize) + 'px'
        });

        const imageText = $(this).find('.h5p-imagetext').get(0);
        if (imageText.scrollHeight > imageText.offsetHeight) {
          const style = window.getComputedStyle($(this).find('.h5p-imagetext').get(0));
          const lineHeight = parseFloat(style.getPropertyValue('line-height'));
          const paddingVertical = parseFloat(style.getPropertyValue('padding-top')) + parseFloat(style.getPropertyValue('padding-bottom'));
          const lines = Math.ceil((imageText.scrollHeight - paddingVertical) / lineHeight);
          const fontSizeLimit = imageText.offsetHeight / lines;

          const fontResized = C.FONT_SCALE_LEVELS_IMAGE_TEXT.some(function (scaleLevel) {
            if (baseFontSize * scaleLevel >= fontSizeLimit) {
              return false;
            }

            imageText.style.fontSize = scaleLevel + 'em';
            return true;
          });

          if (!fontResized) {
            imageText.style.fontSize = C.FONT_SCALE_LEVELS_IMAGE_TEXT.reduce(function (a, b) {
              return Math.min(a, b);
            }) + 'em';
          }
        }
      });
    }
    else {
      this.$inner.children('.h5p-card').each(function () {
        $(this).find('.h5p-cardholder').css({
          'height': ''
        });
        $(this).find('.h5p-imageholder').css({
          'max-height': ''
        });
        $(this).find('.h5p-foot').css({
          'max-height': ''
        });
      });
    }

    //Resize cards holder
    var innerHeight = 0;
    this.$inner.children('.h5p-card').each(function () {
      if ($(this).height() > innerHeight) {
        innerHeight = $(this).height();
      }
    });

    this.$inner.height(innerHeight);

    // Give focus back after orientation change
    if (self.previousFocus) {
      if (window.orientation === 0) {
        self.previousFocus.focus();
      }
      self.previousFocus = null;
    }
  };

  /**
   * Helps convert html to text
   * @type {H5P.jQuery}
   */
  C.$converter = $('<div/>');

  /**
   * Split text by | while respecting \| as escaped |.
   * @param {string} text Text to split.
   * @param {string} [delimiter='|'] Delimiter.
   * @param {string} [escaper='\\'] Escape sequence, default: single backslash.
   * @return {string[]} Split text.
   */
  C.splitAlternatives = function (text, delimiter, escaper) {
    text = text || '';
    delimiter = delimiter || '|';
    escaper = escaper || '\\';

    while (text.indexOf(escaper + delimiter) !== -1) {
      text = text.replace(escaper + delimiter, '\u001a');
    }

    return text
      .split(delimiter)
      .map(function (element) {
        return element = element.replace('\u001a', delimiter);
      });
  };

  /**
   * Get xAPI data.
   * Contract used by report rendering engine.
   *
   * @see contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-6}
   */
  C.prototype.getXAPIData = function () {
    const xAPIEvent = XapiGenerator.getXapiEvent(this);
    return {
      statement: xAPIEvent.data.statement
    };
  };

  /**
   * Get current state.
   * @return {object} Current state.
   */
  C.prototype.getCurrentState = function () {
    const cards = this.$container.find('.h5p-card').toArray()
      .map(function (card) {
        return {
          userAnswer: $(card).find('.h5p-textinput').val(),
          checked: !$(card).find('.h5p-button.h5p-check-button').is(':visible')
        };
      });

    return {
      cards: cards,
      index: this.$resultScreen.is(':visible') ?
        cards.length :
        this.$current.index()
    };
  };

  /**
	 * Get top DOM Window object.
	 * @param {Window} [startWindow=window] Window to start looking from.
	 * @return {Window|null} Top window.
	 */
  C.prototype.getTopWindow = function (startWindow) {
    let sameOrigin;
    startWindow = startWindow || window;

    // H5P iframe may be on different domain than iframe content
    try {
      sameOrigin = startWindow.parent.location.host === window.location.host;
    }
    catch (error) {
      sameOrigin = null;
    }

    if (!sameOrigin) {
      return null;
    }

    if (startWindow.parent === startWindow || ! startWindow.parent) {
      return startWindow;
    }

    return this.getTopWindow(startWindow.parent);
  };

  /**
   * Compute display limits for KidsLoop Live.
   * @return {object|null} Height and width in px or null if cannot be determined.
   */
  C.prototype.computeDisplayLimitsKLL = function () {
    const displayLimits = this.computeDisplayLimits();

    // This only works because KLL enforces height on H5P's iframe
    displayLimits.height = Math.min(displayLimits.height, document.body.offsetHeight);
    return displayLimits;
  };

  /**
   * Compute display limits.
   * @return {object|null} Height and width in px or null if cannot be determined.
   */
  C.prototype.computeDisplayLimits = function () {
    let topWindow = this.getTopWindow();

    // iOS doesn't change screen dimensions on rotation
    let screenSize = (this.isIOS() && this.getOrientation() === 'landscape') ?
      { height: screen.width, width: screen.height } :
      { height: screen.height, width: screen.width };

    topWindow = topWindow || {
      innerHeight: screenSize.height,
      innerWidth: screenSize.width
    };

    // Smallest value of viewport and container wins
    return {
      height: Math.min(topWindow.innerHeight, screenSize.height),
      width: Math.min(topWindow.innerWidth, this.$container.get(0).offsetWidth)
    };
  };

  /**
   * Detect whether user is running iOS.
   * @return {boolean} True, if user is running iOS.
   */
  C.prototype.isIOS = function () {
    return (
      ['iPad Simulator', 'iPhone Simulator', 'iPod Simulator', 'iPad', 'iPhone', 'iPod'].includes(navigator.platform) ||
      (navigator.userAgent.includes('Mac') && 'ontouchend' in document)
    );
  };

  /**
   * Determine whether mobile device in landscape orientation.
   * @return {boolean} True, if mobile device in landscape orientation.
   */
  C.prototype.isMobileLandscape = function () {
    return this.isMobileDevice() && this.getOrientation() === 'landscape';
  };

  /**
   * Detect mobile devices (http://detectmobilebrowsers.com/)
   * @returns {boolean} True if running on a mobile device.
   */
  C.prototype.isMobileDevice = function () {
    let check = false;
    (function (a) {
      if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw-(n|u)|c55\/|capi|ccwa|cdm-|cell|chtm|cldc|cmd-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc-s|devi|dica|dmob|do(c|p)o|ds(12|-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(-|_)|g1 u|g560|gene|gf-5|g-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd-(m|p|t)|hei-|hi(pt|ta)|hp( i|ip)|hs-c|ht(c(-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i-(20|go|ma)|i230|iac( |-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|-[a-w])|libw|lynx|m1-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|-([1-8]|c))|phil|pire|pl(ay|uc)|pn-2|po(ck|rt|se)|prox|psio|pt-g|qa-a|qc(07|12|21|32|60|-[2-7]|i-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h-|oo|p-)|sdk\/|se(c(-|0|1)|47|mc|nd|ri)|sgh-|shar|sie(-|m)|sk-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h-|v-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl-|tdg-|tel(i|m)|tim-|t-mo|to(pl|sh)|ts(70|m-|m3|m5)|tx-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas-|your|zeto|zte-/i.test(a.substr(0, 4))) check = true;
    })(navigator.userAgent || navigator.vendor || window.opera);
    return check;
  };

  /**
   * Get device orientation.
   * @return {string} 'portrait' or 'landscape'.
   */
  C.prototype.getOrientation = function () {
    if (screen.orientation && screen.orientation.type) {
      if (screen.orientation.type.includes('portrait')) {
        return 'portrait';
      }
      else if (screen.orientation.type.includes('landscape')) {
        return 'landscape';
      }
    }

    // Unreliable, as not clear what device's natural orientation is
    if (typeof window.orientation === 'number') {
      if (window.orientation === 0 || window.orientation === 180) {
        return 'portrait';
      }
      else if (window.orientation === 90 || window.orientation === -90 || window.orientation === 270) {
        return 'landscape';
      }
    }

    return 'landscape'; // Assume default
  };

  /** @const {number} Breakpoint for pad height in landscape orientation */
  C.PAD_LANDSCAPE_MIN_HEIGHT = 640;

  /** @const {number[]} Scale levels for font of image text */
  C.FONT_SCALE_LEVELS_IMAGE_TEXT = [1.25, 1, 0.75];

  /** @const {number[]} Scale levels for font of answer field */
  C.FONT_SCALE_LEVELS_ANSWER = [0.75, 0.6, 0.5];

  return C;
})(H5P.jQuery, H5P.Flashcards.xapiGenerator);
