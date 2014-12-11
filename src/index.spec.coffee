fs = require 'fs'

chai = require 'chai'
expect = chai.expect

sinonChai = require 'sinon-chai'
sinon = require 'sinon'
chai.use sinonChai

sandbox = sinon.sandbox.create()
mockery = require 'mockery'

mockery.enable
  useCleanCache: true
  warnOnUnregistered: false



describe 'WatchNetwork', ->

  afterEach ->
    mockery.resetCache()
    mockery.deregisterAll()
    sandbox.restore()

  touchStub = null
  socketStub = null
  WatchNetwork = null
  netMockery = null
  beforeEach ->
    touchStub =
      sync: sandbox.stub()
    mockery.registerMock 'touch', touchStub

    socketStub =
      on: sandbox.stub()
      end: sandbox.stub()
    netMockery =
      connect: sandbox.stub().returns socketStub
    mockery.registerMock 'net', netMockery
    WatchNetwork = require './'


  describe '#initialize', ->
    it 'should execute net.connect when starting', ->
      WatchNetwork().initialize()
      expect(netMockery.connect).to.have.been.called


    it 'should connect to the given host and port', ->
      WatchNetwork(
        host: 'test'
        port: '1337'
      ).initialize()

      expect(netMockery.connect).to.have.been.calledWithExactly
        host: 'test'
        port: '1337'
        sinon.match.func


    it 'should touch a local .root file', ->
      netMockery.connect.yields()

      watchNetwork = WatchNetwork
        host: 'test'
        port: '1337'

      watchNetwork.initialize()

      expect(touchStub.sync).to.have.been.calledWith "#{process.cwd()}/.root"


    it 'should strip everything from the filepaths from the .root file and up', ->
      fileBuffer = toString: ->
        """{
          "added": ["/path/to/.root"]
        }
        """

      socketStub.on.withArgs('data').yields fileBuffer
      watchNetwork = WatchNetwork()
      watchNetwork.on 'changed', (files) ->
        expect(files[0]).to.not.contain '/path/to'
        expect(files[0]).to.equal '.root'

      watchNetwork.initialize()


    it 'should handle multiple file changes at once', ->
      fileBuffer = toString: ->
        """{
          "modified": ["/path/to/modified/file"],
          "added": ["/path/to/.root", "/path/to/added/file"],
          "removed": ["/path/to/removed/file"]
        }
        """

      socketStub.on.withArgs('data').yields fileBuffer
      watchNetwork = WatchNetwork()
      watchNetwork.on 'changed', (files) ->
        expect(files).to.deep.equal [
          'modified/file',
          '.root',
          'added/file',
          'removed/file'
        ]

      watchNetwork.initialize()